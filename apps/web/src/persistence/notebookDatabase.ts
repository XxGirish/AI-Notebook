import Dexie, { type EntityTable } from "dexie";
import type { NotebookPage } from "../domain/pages";
import {
  createRecoverySnapshot,
  migratePersistedPage,
  swapPageWithRecovery,
  type PageRecoverySnapshot,
} from "./pageRecords";

class NotebookDatabase extends Dexie {
  pages!: EntityTable<NotebookPage, "id">;
  recoverySnapshots!: EntityTable<PageRecoverySnapshot, "pageId">;

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
