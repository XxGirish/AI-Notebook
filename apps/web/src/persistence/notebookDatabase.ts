import Dexie, { type EntityTable } from "dexie";
import type { NotebookPage } from "../domain/pages";
import { orphanAssetHashes } from "./assetCleanup";
import {
  assertExpectedPageVersion,
  createRecoverySnapshot,
  migratePersistedPage,
  swapPageWithRecovery,
  type PageRecoverySnapshot,
} from "./pageRecords";

export type AssetRecord = {
  hash: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
};

class NotebookDatabase extends Dexie {
  pages!: EntityTable<NotebookPage, "id">;
  recoverySnapshots!: EntityTable<PageRecoverySnapshot, "pageId">;
  assets!: EntityTable<AssetRecord, "hash">;

  constructor() {
    super("ai-notebook");
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
  }
}

const database = new NotebookDatabase();
const saveTails = new Map<string, Promise<void>>();

export async function loadPages(): Promise<NotebookPage[]> {
  const pages = await database.pages.orderBy("createdAt").toArray();
  return pages.map(migratePersistedPage);
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
  const snapshot = structuredClone(page);
  return enqueuePageWrite(page.id, async () => {
    let hasRecovery = false;
    await database.transaction("rw", database.pages, database.recoverySnapshots, async () => {
      const current = await database.pages.get(page.id);
      assertExpectedPageVersion(current ? migratePersistedPage(current) : undefined, expectedUpdatedAt, page.id);
      if (current) {
        await database.recoverySnapshots.put(createRecoverySnapshot(migratePersistedPage(current)));
        hasRecovery = true;
      }
      await database.pages.put(snapshot);
    });
    return { hasRecovery };
  });
}

export function deletePage(pageId: string, expectedUpdatedAt: number, replacement?: NotebookPage): Promise<void> {
  return enqueuePageWrite(pageId, async () => {
    await database.transaction("rw", database.pages, database.recoverySnapshots, async () => {
      const current = await database.pages.get(pageId);
      assertExpectedPageVersion(current ? migratePersistedPage(current) : undefined, expectedUpdatedAt, pageId);
      await database.pages.delete(pageId);
      await database.recoverySnapshots.delete(pageId);
      if (replacement) await database.pages.add(structuredClone(replacement));
    });
  });
}

export async function hasRecoverySnapshot(pageId: string): Promise<boolean> {
  return (await database.recoverySnapshots.get(pageId)) !== undefined;
}

export function restorePreviousPage(pageId: string, expectedUpdatedAt: number): Promise<NotebookPage | undefined> {
  return enqueuePageWrite(pageId, async () => database.transaction(
    "rw",
    database.pages,
    database.recoverySnapshots,
    async () => {
      const [currentRecord, recovery] = await Promise.all([
        database.pages.get(pageId),
        database.recoverySnapshots.get(pageId),
      ]);
      assertExpectedPageVersion(currentRecord ? migratePersistedPage(currentRecord) : undefined, expectedUpdatedAt, pageId);
      if (!currentRecord || !recovery) return undefined;

      const swapped = swapPageWithRecovery(
        migratePersistedPage(currentRecord),
        { ...recovery, page: migratePersistedPage(recovery.page) },
      );
      await database.pages.put(swapped.restored);
      await database.recoverySnapshots.put(swapped.recovery);
      return swapped.restored;
    },
  ));
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

export async function storeImportedNotebook(pages: NotebookPage[], assets: AssetRecord[]): Promise<void> {
  await database.transaction("rw", database.pages, database.assets, async () => {
    await database.assets.bulkPut(assets);
    await database.pages.bulkAdd(pages);
  });
}

export async function cleanupOrphanAssets(): Promise<{ removedCount: number; removedBytes: number }> {
  return database.transaction("rw", database.pages, database.recoverySnapshots, database.assets, async () => {
    const [pageRecords, recoveryRecords, assetRecords] = await Promise.all([
      database.pages.toArray(),
      database.recoverySnapshots.toArray(),
      database.assets.toArray(),
    ]);
    const pages = pageRecords.map(migratePersistedPage);
    const recoveries = recoveryRecords.map((recovery) => ({ ...recovery, page: migratePersistedPage(recovery.page) }));
    const orphanHashes = orphanAssetHashes(pages, recoveries, assetRecords.map((asset) => asset.hash));
    if (orphanHashes.length === 0) return { removedCount: 0, removedBytes: 0 };

    const orphanSet = new Set(orphanHashes);
    const removedBytes = assetRecords.reduce((total, asset) => orphanSet.has(asset.hash) ? total + asset.size : total, 0);
    await database.assets.bulkDelete(orphanHashes);
    return { removedCount: orphanHashes.length, removedBytes };
  });
}
