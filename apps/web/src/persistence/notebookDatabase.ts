import Dexie, { type EntityTable } from "dexie";
import type { NotebookPage } from "../domain/pages";
import {
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

export function savePage(page: NotebookPage): Promise<{ hasRecovery: boolean }> {
  const snapshot = structuredClone(page);
  return enqueuePageWrite(page.id, async () => {
    let hasRecovery = false;
    await database.transaction("rw", database.pages, database.recoverySnapshots, async () => {
      const current = await database.pages.get(page.id);
      if (current) {
        await database.recoverySnapshots.put(createRecoverySnapshot(migratePersistedPage(current)));
        hasRecovery = true;
      }
      await database.pages.put(snapshot);
    });
    return { hasRecovery };
  });
}

export function deletePage(pageId: string): Promise<void> {
  return enqueuePageWrite(pageId, async () => {
    await database.transaction("rw", database.pages, database.recoverySnapshots, async () => {
      await database.pages.delete(pageId);
      await database.recoverySnapshots.delete(pageId);
    });
  });
}

export async function hasRecoverySnapshot(pageId: string): Promise<boolean> {
  return (await database.recoverySnapshots.get(pageId)) !== undefined;
}

export function restorePreviousPage(pageId: string): Promise<NotebookPage | undefined> {
  return enqueuePageWrite(pageId, async () => database.transaction(
    "rw",
    database.pages,
    database.recoverySnapshots,
    async () => {
      const [currentRecord, recovery] = await Promise.all([
        database.pages.get(pageId),
        database.recoverySnapshots.get(pageId),
      ]);
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
