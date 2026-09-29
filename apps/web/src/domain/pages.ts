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
    schemaVersion: 4,
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

/**
 * Pages in the writer's chosen order. Pages the order does not mention (new or
 * imported since it was saved) follow in creation order; ids of pages that no
 * longer exist are ignored.
 */
export function orderPages<T extends Pick<NotebookPage, "id" | "createdAt">>(pages: readonly T[], order: readonly string[]): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  return [...pages].sort((left, right) => {
    const leftPosition = position.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightPosition = position.get(right.id) ?? Number.POSITIVE_INFINITY;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    return left.createdAt - right.createdAt;
  });
}

/** Moves one page to a new index, clamped to the list. */
export function movePage<T extends Pick<NotebookPage, "id">>(pages: readonly T[], pageId: string, toIndex: number): T[] {
  const from = pages.findIndex((page) => page.id === pageId);
  if (from === -1) return [...pages];
  const next = [...pages];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
  return next;
}
