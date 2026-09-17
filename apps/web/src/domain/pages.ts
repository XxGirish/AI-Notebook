import type { NotebookFixture, NotebookObject } from "./notebook";

export type NotebookPage = NotebookFixture & {
  createdAt: number;
  updatedAt: number;
};

export const normalizePageTitle = (title: string, fallback = "Untitled page") => {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || fallback;
};

export function createNotebookPage(title: string, now = Date.now()): NotebookPage {
  return {
    schemaVersion: 3,
    id: `page-${crypto.randomUUID()}`,
    title: normalizePageTitle(title),
    width: 1280,
    height: 820,
    objects: [],
    aiTransactions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function pageFromFixture(fixture: NotebookFixture, now = Date.now()): NotebookPage {
  return {
    ...fixture,
    objects: structuredClone(fixture.objects),
    createdAt: now,
    updatedAt: now,
  };
}

export function renamePage(page: NotebookPage, title: string, now = Date.now()): NotebookPage {
  return { ...page, title: normalizePageTitle(title, page.title), updatedAt: Math.max(now, page.updatedAt + 1) };
}

export function replacePageObjects(page: NotebookPage, objects: NotebookObject[], now = Date.now()): NotebookPage {
  return { ...page, objects, updatedAt: Math.max(now, page.updatedAt + 1) };
}
