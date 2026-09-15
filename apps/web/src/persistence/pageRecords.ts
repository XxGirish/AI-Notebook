import type { AiTransactionRecord, NotebookObject } from "../domain/notebook";
import { normalizePageTitle, type NotebookPage } from "../domain/pages";

export const CURRENT_PAGE_SCHEMA_VERSION = 2;

export type PageRecoverySnapshot = {
  pageId: string;
  capturedAt: number;
  page: NotebookPage;
};

export class PageWriteConflictError extends Error {
  constructor(pageId: string) {
    super(`Page ${pageId} changed in another tab`);
    this.name = "PageWriteConflictError";
  }
}

export function assertExpectedPageVersion(current: NotebookPage | undefined, expectedUpdatedAt: number | undefined, pageId: string): void {
  if (expectedUpdatedAt === undefined) {
    if (current) throw new PageWriteConflictError(pageId);
    return;
  }
  if (!current || current.updatedAt !== expectedUpdatedAt) throw new PageWriteConflictError(pageId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function migrateObject(value: unknown): NotebookObject {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string") {
    throw new Error("Stored page contains an invalid object");
  }

  return {
    ...value,
    revision: Math.max(1, finiteNumber(value.revision, 1)),
  } as NotebookObject;
}

function migrateAiTransaction(value: unknown): AiTransactionRecord {
  if (!isRecord(value) || typeof value.transactionId !== "string" || typeof value.requestId !== "string") {
    throw new Error("Stored page contains an invalid AI transaction");
  }
  if (!Array.isArray(value.generatedObjectIds) || !Array.isArray(value.updatedObjectIds) || !Array.isArray(value.sources)) {
    throw new Error(`AI transaction ${value.transactionId} has invalid references`);
  }
  return structuredClone(value) as AiTransactionRecord;
}

/**
 * Converts records from every previously shipped page schema to the current
 * document shape. Throwing aborts the IndexedDB upgrade instead of partially
 * rewriting a notebook that cannot be understood safely.
 */
export function migratePersistedPage(value: unknown): NotebookPage {
  if (!isRecord(value)) throw new Error("Stored page is not an object");

  const schemaVersion = finiteNumber(value.schemaVersion, 0);
  if (schemaVersion > CURRENT_PAGE_SCHEMA_VERSION) {
    throw new Error(`Page schema ${schemaVersion} is newer than this application supports`);
  }
  if (typeof value.id !== "string" || !value.id) throw new Error("Stored page has no id");
  if (!Array.isArray(value.objects)) throw new Error(`Stored page ${value.id} has no object list`);

  const createdAt = finiteNumber(value.createdAt, Date.now());
  const aiTransactions = schemaVersion >= 2
    ? (Array.isArray(value.aiTransactions) ? value.aiTransactions.map(migrateAiTransaction) : (() => { throw new Error(`Stored page ${value.id} has no AI transaction list`); })())
    : [];
  return {
    schemaVersion: CURRENT_PAGE_SCHEMA_VERSION,
    id: value.id,
    title: normalizePageTitle(typeof value.title === "string" ? value.title : "Untitled page"),
    width: finiteNumber(value.width, 1280),
    height: finiteNumber(value.height, 820),
    objects: value.objects.map(migrateObject),
    aiTransactions,
    createdAt,
    updatedAt: finiteNumber(value.updatedAt, createdAt),
  };
}

export function createRecoverySnapshot(page: NotebookPage, capturedAt = Date.now()): PageRecoverySnapshot {
  return { pageId: page.id, capturedAt, page: structuredClone(page) };
}

export function swapPageWithRecovery(
  current: NotebookPage,
  recovery: PageRecoverySnapshot,
  now = Date.now(),
): { restored: NotebookPage; recovery: PageRecoverySnapshot } {
  if (current.id !== recovery.pageId || recovery.page.id !== current.id) {
    throw new Error("Recovery snapshot belongs to another page");
  }

  return {
    restored: { ...structuredClone(recovery.page), updatedAt: Math.max(now, current.updatedAt + 1, recovery.page.updatedAt + 1) },
    recovery: createRecoverySnapshot(current, now),
  };
}
