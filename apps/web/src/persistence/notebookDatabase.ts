import Dexie, { type EntityTable, type Table, type Transaction } from "dexie";
import type { NotebookObject } from "../domain/notebook";
import type { NotebookPage } from "../domain/pages";
import { orphanAssetHashes } from "./assetCleanup";
import {
  applyRecoveryPatch,
  assemblePage,
  diffPageObjects,
  objectMapOf,
  recoveredObjects,
  recoveryPatchFor,
  splitPage,
  type PageMetadataRecord,
  type PageObjectKey,
  type PageObjectRecord,
  type PageObjectWrites,
  type PageRecoveryPatch,
} from "./pageDelta";
import { assertExpectedPageVersion, migratePersistedPage } from "./pageRecords";

export type AssetRecord = {
  hash: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
};

/** An uploaded file, kept as extracted text only; the original file is not stored. */
export type SourceRecord = {
  id: string;
  name: string;
  kind: "pdf" | "docx" | "text";
  size: number;
  /** SHA-256 of the original file, so the same file is not added twice. */
  contentHash: string;
  pageCount?: number;
  chunkCount: number;
  characterCount: number;
  /** Whether the chat may retrieve from it. */
  enabled: boolean;
  addedAt: number;
};

export type SourceChunkRecord = {
  id: string;
  sourceId: string;
  ordinal: number;
  page?: number;
  text: string;
};

/** A cited passage as it was sent, so an old answer's citations still open after the source changes or is removed. */
export type ChatCitation = { id: string; origin: string; locator: string; text: string; sourceId?: string; pageId?: string; objectId?: string };

export type ChatMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  citations?: ChatCitation[];
  /** Set when an answer stopped early; its text is kept but it is not sent back as context. */
  incomplete?: boolean;
  provider?: string;
  model?: string;
};

class NotebookDatabase extends Dexie {
  pages!: EntityTable<PageMetadataRecord, "id">;
  pageObjects!: Table<PageObjectRecord, PageObjectKey>;
  recoverySnapshots!: EntityTable<PageRecoveryPatch, "pageId">;
  assets!: EntityTable<AssetRecord, "hash">;
  sources!: EntityTable<SourceRecord, "id">;
  sourceChunks!: EntityTable<SourceChunkRecord, "id">;
  chatMessages!: EntityTable<ChatMessageRecord, "id">;

  constructor(name = "ai-notebook") {
    super(name);
    this.version(1).stores({ pages: "id, createdAt, updatedAt" });
    this.version(2).stores({
      pages: "id, createdAt, updatedAt",
      recoverySnapshots: "pageId, capturedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("pages").toCollection().modify((page) => {
        const migrated = migratePersistedPage(page);
        for (const key of Object.keys(page)) delete page[key];
        Object.assign(page, migrated);
      });
    });
    this.version(3).stores({
      pages: "id, createdAt, updatedAt",
      recoverySnapshots: "pageId, capturedAt",
      assets: "hash, createdAt",
    });
    // Version 4 moves objects out of the page row into one row each, so a save
    // writes only what changed. The document schema is unaffected: archives
    // still carry whole pages.
    this.version(4).stores({
      pages: "id, createdAt, updatedAt",
      pageObjects: "[pageId+objectId], pageId, kind",
      recoverySnapshots: "pageId, capturedAt",
      assets: "hash, createdAt",
    }).upgrade(splitStoredPages);
    // Version 5 adds uploaded sources and the chat history. Nothing existing changes.
    this.version(5).stores({
      pages: "id, createdAt, updatedAt",
      pageObjects: "[pageId+objectId], pageId, kind",
      recoverySnapshots: "pageId, capturedAt",
      assets: "hash, createdAt",
      sources: "id, addedAt, contentHash",
      sourceChunks: "id, sourceId",
      chatMessages: "id, createdAt",
    });
  }
}

/**
 * Rewrites every whole-page record as metadata plus object rows, and every
 * recovery snapshot as a patch covering all of its objects. Throwing aborts the
 * upgrade rather than leaving a notebook half converted.
 */
async function splitStoredPages(transaction: Transaction): Promise<void> {
  const pagesTable = transaction.table("pages");
  const objectsTable = transaction.table("pageObjects");
  const recoveryTable = transaction.table("recoverySnapshots");

  for (const record of await pagesTable.toArray()) {
    const { metadata, objects } = splitPage(migratePersistedPage(record));
    await objectsTable.bulkPut(objects);
    await pagesTable.put(metadata);
  }

  for (const record of await recoveryTable.toArray()) {
    const { metadata, objects } = splitPage(migratePersistedPage(record.page));
    const patched: Record<string, NotebookObject | null> = {};
    for (const row of objects) patched[row.objectId] = row.object;
    const current = await pagesTable.get(record.pageId) as PageMetadataRecord | undefined;
    for (const objectId of current?.objectIds ?? []) {
      if (!(objectId in patched)) patched[objectId] = null;
    }
    await recoveryTable.put({
      pageId: record.pageId,
      capturedAt: typeof record.capturedAt === "number" ? record.capturedAt : Date.now(),
      metadata,
      objects: patched,
    });
  }
}

const database = new NotebookDatabase();
const saveTails = new Map<string, Promise<void>>();

/**
 * What this tab last handed the database for each page, by object identity. It
 * is the starting point of the next diff, so an ordinary save never reads the
 * page back. It is dropped whenever a write fails or another tab wins a
 * conflict, and the next save then reads the stored objects instead.
 */
const savedObjects = new Map<string, Map<string, NotebookObject>>();

function rememberSavedObjects(page: NotebookPage): void {
  savedObjects.set(page.id, objectMapOf(page.objects));
}

async function storedObjectMap(pageId: string): Promise<Map<string, NotebookObject>> {
  const rows = await database.pageObjects.where("pageId").equals(pageId).toArray();
  return new Map(rows.map((row) => [row.objectId, row.object]));
}

async function applyObjectWrites(writes: PageObjectWrites): Promise<void> {
  if (writes.deletes.length > 0) await database.pageObjects.bulkDelete(writes.deletes);
  if (writes.puts.length > 0) await database.pageObjects.bulkPut(writes.puts);
}

export async function loadPages(): Promise<NotebookPage[]> {
  const [metadataRows, objectRows] = await Promise.all([
    database.pages.orderBy("createdAt").toArray(),
    database.pageObjects.toArray(),
  ]);
  const rowsByPage = new Map<string, PageObjectRecord[]>();
  for (const row of objectRows) {
    const rows = rowsByPage.get(row.pageId);
    if (rows) rows.push(row);
    else rowsByPage.set(row.pageId, [row]);
  }

  const pages = metadataRows.map((metadata) => (
    migratePersistedPage(assemblePage(metadata, rowsByPage.get(metadata.id) ?? []))
  ));
  savedObjects.clear();
  for (const page of pages) rememberSavedObjects(page);
  return pages;
}

function enqueuePageWrite<T>(pageId: string, operation: () => Promise<T>): Promise<T> {
  const previous = saveTails.get(pageId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const tail = next.then(() => undefined);
  saveTails.set(pageId, tail);
  const cleanup = () => {
    if (saveTails.get(pageId) === tail) saveTails.delete(pageId);
  };
  void tail.then(cleanup, cleanup);
  return next;
}

export function savePage(page: NotebookPage, expectedUpdatedAt?: number): Promise<{ hasRecovery: boolean }> {
  // The state to diff against is taken now, before the mirror moves on, so that
  // a second save queued behind this one still compares against the right page.
  const previous = savedObjects.get(page.id);
  rememberSavedObjects(page);
  const { metadata } = splitPage(page);

  return enqueuePageWrite(page.id, async () => {
    try {
      let hasRecovery = false;
      await database.transaction("rw", database.pages, database.pageObjects, database.recoverySnapshots, async () => {
        const current = await database.pages.get(page.id);
        assertExpectedPageVersion(current, expectedUpdatedAt, page.id);

        const before = previous ?? (current ? await storedObjectMap(page.id) : new Map<string, NotebookObject>());
        const writes = diffPageObjects(page.id, before, page.objects);
        if (current) {
          await database.recoverySnapshots.put(structuredClone(recoveryPatchFor(current, before, writes)));
          hasRecovery = true;
        }
        await applyObjectWrites(structuredClone(writes));
        await database.pages.put(structuredClone(metadata));
      });
      return { hasRecovery };
    } catch (error) {
      savedObjects.delete(page.id);
      throw error;
    }
  });
}

export function deletePage(pageId: string, expectedUpdatedAt: number, replacement?: NotebookPage): Promise<void> {
  return enqueuePageWrite(pageId, async () => {
    try {
      await database.transaction("rw", database.pages, database.pageObjects, database.recoverySnapshots, async () => {
        const current = await database.pages.get(pageId);
        assertExpectedPageVersion(current, expectedUpdatedAt, pageId);
        await database.pages.delete(pageId);
        await database.pageObjects.where("pageId").equals(pageId).delete();
        await database.recoverySnapshots.delete(pageId);
        if (replacement) {
          const split = splitPage(replacement);
          await database.pageObjects.bulkAdd(structuredClone(split.objects));
          await database.pages.add(structuredClone(split.metadata));
        }
      });
      savedObjects.delete(pageId);
      if (replacement) rememberSavedObjects(replacement);
    } catch (error) {
      savedObjects.delete(pageId);
      if (replacement) savedObjects.delete(replacement.id);
      throw error;
    }
  });
}

export async function hasRecoverySnapshot(pageId: string): Promise<boolean> {
  return (await database.recoverySnapshots.get(pageId)) !== undefined;
}

export function restorePreviousPage(pageId: string, expectedUpdatedAt: number): Promise<NotebookPage | undefined> {
  return enqueuePageWrite(pageId, async () => {
    try {
      const restored = await database.transaction(
        "rw",
        database.pages,
        database.pageObjects,
        database.recoverySnapshots,
        async () => {
          const [current, patch] = await Promise.all([
            database.pages.get(pageId),
            database.recoverySnapshots.get(pageId),
          ]);
          assertExpectedPageVersion(current, expectedUpdatedAt, pageId);
          if (!current || !patch) return undefined;

          // Only the objects the patch names can differ, so only those are read.
          const patchedIds = Object.keys(patch.objects);
          const rows = await database.pageObjects.bulkGet(patchedIds.map((objectId) => [pageId, objectId]));
          const currentObjects = new Map<string, NotebookObject>();
          for (const row of rows) {
            if (row) currentObjects.set(row.objectId, row.object);
          }

          const swap = applyRecoveryPatch(current, currentObjects, patch);
          await applyObjectWrites(structuredClone(swap.writes));
          await database.pages.put(structuredClone(swap.metadata));
          await database.recoverySnapshots.put(structuredClone(swap.recovery));
          return assemblePage(swap.metadata, await database.pageObjects.where("pageId").equals(pageId).toArray());
        },
      );
      if (!restored) return undefined;
      const page = migratePersistedPage(restored);
      rememberSavedObjects(page);
      return page;
    } catch (error) {
      savedObjects.delete(pageId);
      throw error;
    }
  });
}

export async function saveAsset(blob: Blob): Promise<AssetRecord> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const existing = await database.assets.get(hash);
  if (existing) return existing;
  const asset: AssetRecord = { hash, blob, mimeType: blob.type, size: blob.size, createdAt: Date.now() };
  await database.assets.put(asset);
  return asset;
}

export async function loadAsset(hash: string): Promise<AssetRecord | undefined> {
  return database.assets.get(hash);
}

export async function loadAssets(hashes: Iterable<string>): Promise<AssetRecord[]> {
  const uniqueHashes = [...new Set(hashes)];
  const records = await database.assets.bulkGet(uniqueHashes);
  return records.filter((record): record is AssetRecord => record !== undefined);
}

export type ImportedLibrary = {
  sources: { source: SourceRecord; chunks: SourceChunkRecord[] }[];
  chatMessages: ChatMessageRecord[];
};

/** Stores an imported copy in one transaction: a failure leaves no page, source or message of it behind. */
export async function storeImportedNotebook(
  pages: NotebookPage[],
  assets: AssetRecord[],
  library: ImportedLibrary = { sources: [], chatMessages: [] },
): Promise<void> {
  const split = pages.map(splitPage);
  await database.transaction("rw", [database.pages, database.pageObjects, database.assets, database.sources, database.sourceChunks, database.chatMessages], async () => {
    await database.assets.bulkPut(assets);
    await database.pageObjects.bulkAdd(split.flatMap((page) => page.objects));
    await database.pages.bulkAdd(split.map((page) => page.metadata));
    await database.sources.bulkAdd(library.sources.map((entry) => entry.source));
    await database.sourceChunks.bulkAdd(library.sources.flatMap((entry) => entry.chunks));
    await database.chatMessages.bulkAdd(library.chatMessages);
  });
  for (const page of pages) rememberSavedObjects(page);
}

export async function cleanupOrphanAssets(): Promise<{ removedCount: number; removedBytes: number }> {
  return database.transaction("rw", database.pageObjects, database.recoverySnapshots, database.assets, async () => {
    // Only image objects can hold an asset and they are indexed by kind, so
    // this does not read the notebook's ink.
    const [imageRows, recoveryRecords, assetRecords] = await Promise.all([
      database.pageObjects.where("kind").equals("image").toArray(),
      database.recoverySnapshots.toArray(),
      database.assets.toArray(),
    ]);
    const orphanHashes = orphanAssetHashes(
      [imageRows.map((row) => row.object), ...recoveryRecords.map(recoveredObjects)],
      assetRecords.map((asset) => asset.hash),
    );
    if (orphanHashes.length === 0) return { removedCount: 0, removedBytes: 0 };

    const orphanSet = new Set(orphanHashes);
    const removedBytes = assetRecords.reduce((total, asset) => orphanSet.has(asset.hash) ? total + asset.size : total, 0);
    await database.assets.bulkDelete(orphanHashes);
    return { removedCount: orphanHashes.length, removedBytes };
  });
}

export async function loadSources(): Promise<SourceRecord[]> {
  return database.sources.orderBy("addedAt").toArray();
}

export async function loadSourceChunks(): Promise<SourceChunkRecord[]> {
  return database.sourceChunks.toArray();
}

export async function findSourceByHash(contentHash: string): Promise<SourceRecord | undefined> {
  return database.sources.where("contentHash").equals(contentHash).first();
}

/** Adds a source and all of its passages together, so a failed write leaves no half-added file. */
export async function storeSource(source: SourceRecord, chunks: SourceChunkRecord[]): Promise<void> {
  await database.transaction("rw", database.sources, database.sourceChunks, async () => {
    await database.sources.add(source);
    await database.sourceChunks.bulkAdd(chunks);
  });
}

export async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  await database.sources.update(sourceId, { enabled });
}

export async function deleteSource(sourceId: string): Promise<void> {
  await database.transaction("rw", database.sources, database.sourceChunks, async () => {
    await database.sourceChunks.where("sourceId").equals(sourceId).delete();
    await database.sources.delete(sourceId);
  });
}

/** Every source with its passages, and the chat history, read in one consistent snapshot for export. */
export async function loadLibrary(): Promise<ImportedLibrary> {
  return database.transaction("r", database.sources, database.sourceChunks, database.chatMessages, async () => {
    const [sources, chunks, chatMessages] = await Promise.all([
      database.sources.orderBy("addedAt").toArray(),
      database.sourceChunks.toArray(),
      database.chatMessages.orderBy("createdAt").toArray(),
    ]);
    const chunksBySource = new Map<string, SourceChunkRecord[]>();
    for (const chunk of chunks) {
      const list = chunksBySource.get(chunk.sourceId);
      if (list) list.push(chunk);
      else chunksBySource.set(chunk.sourceId, [chunk]);
    }
    return {
      sources: sources.map((source) => ({ source, chunks: (chunksBySource.get(source.id) ?? []).sort((left, right) => left.ordinal - right.ordinal) })),
      chatMessages,
    };
  });
}

export async function loadChatMessages(): Promise<ChatMessageRecord[]> {
  return database.chatMessages.orderBy("createdAt").toArray();
}

export async function saveChatMessage(message: ChatMessageRecord): Promise<void> {
  await database.chatMessages.put(message);
}

export async function clearChatMessages(): Promise<void> {
  await database.chatMessages.clear();
}
