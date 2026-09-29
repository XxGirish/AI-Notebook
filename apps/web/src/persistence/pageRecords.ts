import { isPaperStyle } from "../domain/paper";
import type { AiTransactionRecord, NotebookObject } from "../domain/notebook";
import { diagramAdapter } from "../domain/diagramAdapter";
import { learningObjectAdapter } from "../domain/learningObjectAdapters";
import { normalizePageTitle, type NotebookPage } from "../domain/pages";

export const CURRENT_PAGE_SCHEMA_VERSION = 4;

// Schema 3 added converted handwriting; schema 4 added typed canvas text.
const OBJECT_KIND_INTRODUCED_IN: Record<string, number> = { "ink-text": 3, text: 4 };

export class PageWriteConflictError extends Error {
  constructor(pageId: string) {
    super(`Page ${pageId} changed in another tab`);
    this.name = "PageWriteConflictError";
  }
}

export function assertExpectedPageVersion(current: { updatedAt: number } | undefined, expectedUpdatedAt: number | undefined, pageId: string): void {
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

  const normalized: Record<string, unknown> = {
    ...value,
    revision: Math.max(1, finiteNumber(value.revision, 1)),
  };
  if (value.kind === "text-card" || value.kind === "equation-card" || value.kind === "quiz-card") {
    return learningObjectAdapter.migrate(normalized);
  }
  if (value.kind === "graph-node" || value.kind === "connector") {
    return diagramAdapter.migrate(normalized);
  }
  return normalized as NotebookObject;
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
  // An older record claiming to contain an object kind introduced by a later
  // schema was not written by this application.
  if (schemaVersion > 0 && value.objects.some((object) => isRecord(object) && typeof object.kind === "string" && schemaVersion < (OBJECT_KIND_INTRODUCED_IN[object.kind] ?? 0))) {
    throw new Error(`Stored page ${value.id} contains objects its schema does not support`);
  }

  // Objects are stored one row per id, so two objects sharing an id would lose
  // one of them silently. Refusing the record keeps the loss visible instead.
  const seenObjectIds = new Set<string>();
  for (const object of value.objects) {
    if (!isRecord(object) || typeof object.id !== "string") continue;
    if (seenObjectIds.has(object.id)) throw new Error(`Stored page ${value.id} repeats object id ${object.id}`);
    seenObjectIds.add(object.id);
  }

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
    ...(isPaperStyle(value.paper) ? { paper: value.paper } : {}),
    objects: value.objects.map(migrateObject),
    aiTransactions,
    createdAt,
    updatedAt: finiteNumber(value.updatedAt, createdAt),
  };
}
