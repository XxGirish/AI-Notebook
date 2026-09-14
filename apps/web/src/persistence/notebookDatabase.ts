import Dexie, { type EntityTable } from "dexie";
import type { NotebookPage } from "../domain/pages";

class NotebookDatabase extends Dexie {
  pages!: EntityTable<NotebookPage, "id">;

  constructor() {
    super("ai-notebook");
    this.version(1).stores({ pages: "id, createdAt, updatedAt" });
  }
}

const database = new NotebookDatabase();
const saveTails = new Map<string, Promise<void>>();

export async function loadPages(): Promise<NotebookPage[]> {
  return database.pages.orderBy("createdAt").toArray();
}

export function savePage(page: NotebookPage): Promise<void> {
  const snapshot = structuredClone(page);
  const previous = saveTails.get(page.id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await database.pages.put(snapshot);
  });
  saveTails.set(page.id, next);
  void next.finally(() => {
    if (saveTails.get(page.id) === next) saveTails.delete(page.id);
  });
  return next;
}

export function deletePage(pageId: string): Promise<void> {
  const previous = saveTails.get(pageId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await database.pages.delete(pageId);
  });
  saveTails.set(pageId, next);
  void next.finally(() => {
    if (saveTails.get(pageId) === next) saveTails.delete(pageId);
  });
  return next;
}
