import type { AiTransactionRecord } from "./notebook";

/**
 * A writer's report that a piece of AI-generated content was wrong or
 * unhelpful. It stays on this device: nothing is sent to the gateway or to
 * DeepSeek. It keeps a snapshot of the content as reported, and the exact
 * request and model that produced it, so the report still means something
 * after the card is corrected, and can later become a regression fixture.
 */
export type AiFeedbackReason = "incorrect" | "misleading" | "unhelpful" | "other";

export type AiFeedbackRecord = {
  id: string;
  pageId: string;
  objectId: string;
  /** The object's revision when reported; a later edit is a correction, not the reported content. */
  objectRevision: number;
  transactionId: string;
  requestId: string;
  intent: AiTransactionRecord["intent"];
  provider: string;
  model: string;
  configurationId: string;
  reason: AiFeedbackReason;
  note?: string;
  /** The content's plain text when it was reported. */
  contentSnapshot: string;
  createdAt: number;
};

export const AI_FEEDBACK_REASONS: Record<AiFeedbackReason, string> = {
  incorrect: "It is factually wrong",
  misleading: "It is misleading or confusing",
  unhelpful: "It does not help with my notes",
  other: "Something else",
};

export const MAX_FEEDBACK_NOTE = 1_000;
export const MAX_FEEDBACK_SNAPSHOT = 20_000;

export function createAiFeedback(options: {
  id: string;
  pageId: string;
  object: { id: string; revision: number };
  transaction: AiTransactionRecord;
  reason: AiFeedbackReason;
  note?: string;
  contentSnapshot: string;
  createdAt: number;
}): AiFeedbackRecord {
  const note = options.note?.trim().slice(0, MAX_FEEDBACK_NOTE);
  const { transaction } = options;
  return {
    id: options.id,
    pageId: options.pageId,
    objectId: options.object.id,
    objectRevision: options.object.revision,
    transactionId: transaction.transactionId,
    requestId: transaction.requestId,
    intent: transaction.intent,
    provider: transaction.provider,
    model: transaction.model,
    configurationId: transaction.configurationId,
    reason: options.reason,
    ...(note ? { note } : {}),
    contentSnapshot: options.contentSnapshot.slice(0, MAX_FEEDBACK_SNAPSHOT),
    createdAt: options.createdAt,
  };
}

/** The transaction that generated each object on a page, for provenance and reporting. */
export function generatingTransactions(transactions: readonly AiTransactionRecord[]): Map<string, AiTransactionRecord> {
  const byObject = new Map<string, AiTransactionRecord>();
  for (const transaction of transactions) for (const id of transaction.generatedObjectIds) byObject.set(id, transaction);
  return byObject;
}
