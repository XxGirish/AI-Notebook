import { AI_FEEDBACK_REASONS, MAX_FEEDBACK_NOTE, MAX_FEEDBACK_SNAPSHOT, type AiFeedbackRecord } from "../domain/aiFeedback";
import type { QuizAttemptRecord } from "../domain/quizAttempts";
import type { ChatCitation, ChatMessageRecord, SourceChunkRecord, SourceRecord } from "./notebookDatabase";

/**
 * The notebook's library: uploaded sources (as extracted passages) and the
 * chat history. These live outside pages, so archives carry them as their own
 * entries and validate them as strictly as page data before anything is stored.
 */

export type ArchivedSource = { source: SourceRecord; chunks: SourceChunkRecord[] };
export type NotebookLibrary = { sources: ArchivedSource[]; chatMessages: ChatMessageRecord[]; quizAttempts?: QuizAttemptRecord[]; aiFeedback?: AiFeedbackRecord[] };

export const MAX_ARCHIVED_SOURCES = 200;
export const MAX_ARCHIVED_CHAT_MESSAGES = 5_000;
export const MAX_ARCHIVED_QUIZ_ATTEMPTS = 50_000;
export const MAX_ARCHIVED_AI_FEEDBACK = 5_000;
const AI_INTENTS = new Set(["teach_section", "explain_selection", "create_diagram", "create_equation", "create_quiz", "chat_answer"]);
const MAX_CHUNKS_PER_SOURCE = 5_000;
const MAX_CHUNK_CHARACTERS = 4_000;
const MAX_MESSAGE_CHARACTERS = 100_000;
const MAX_CITATIONS = 50;

/** A source's passages as stored in the archive: identity is derived from the source on import. */
type ArchivedChunk = { ordinal: number; page?: number; text: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalString = (value: unknown, max: number) => value === undefined || (typeof value === "string" && value.length <= max);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
const SOURCE_KINDS = new Set(["pdf", "docx", "text"]);

function fail(message: string): never {
  throw new Error(`Invalid .ainotebook archive: ${message}`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const allowedKeys = new Set(allowed);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) fail(`${label} contains unsupported field ${unknownKey}`);
}

/** The archive form of one source: its record plus passages without device-specific ids. */
export function archivedSourceDocument({ source, chunks }: ArchivedSource) {
  const ordered = [...chunks].sort((left, right) => left.ordinal - right.ordinal);
  return {
    source: structuredClone(source),
    chunks: ordered.map(({ ordinal, page, text }): ArchivedChunk => (page === undefined ? { ordinal, text } : { ordinal, page, text })),
  };
}

export function validateArchivedSource(value: unknown): ArchivedSource {
  if (!isRecord(value)) fail("a source entry is not an object");
  assertOnlyKeys(value, ["source", "chunks"], "source entry");
  const source = value.source;
  if (!isRecord(source)) fail("a source entry has no source record");
  assertOnlyKeys(source, ["id", "name", "kind", "size", "contentHash", "pageCount", "chunkCount", "characterCount", "enabled", "addedAt"], "source record");
  if (!isString(source.id, 200) || !isString(source.name, 200) || !SOURCE_KINDS.has(String(source.kind)) || !isHash(source.contentHash)) {
    fail("a source has an invalid id, name, kind or content hash");
  }
  const label = `source ${source.name}`;
  if (!Number.isInteger(source.size) || (source.size as number) < 0 || !isFiniteNumber(source.addedAt) || typeof source.enabled !== "boolean") fail(`${label} has invalid metadata`);
  if (source.pageCount !== undefined && !isPositiveInteger(source.pageCount)) fail(`${label} has an invalid page count`);
  if (!isPositiveInteger(source.chunkCount) || source.chunkCount > MAX_CHUNKS_PER_SOURCE || !Number.isInteger(source.characterCount)) fail(`${label} has invalid passage counts`);

  if (!Array.isArray(value.chunks) || value.chunks.length !== source.chunkCount) fail(`${label} does not contain the passages it declares`);
  let characters = 0;
  const chunks = value.chunks.map((chunk, index): SourceChunkRecord => {
    if (!isRecord(chunk)) fail(`${label} has an invalid passage`);
    assertOnlyKeys(chunk, ["ordinal", "page", "text"], `${label} passage`);
    if (chunk.ordinal !== index || !isString(chunk.text, MAX_CHUNK_CHARACTERS)) fail(`${label} has an invalid passage`);
    if (chunk.page !== undefined && (!isPositiveInteger(chunk.page) || (source.pageCount !== undefined && chunk.page > (source.pageCount as number)))) {
      fail(`${label} has a passage on a page it does not have`);
    }
    characters += chunk.text.length;
    return {
      id: `${source.id}:${index}`,
      sourceId: source.id as string,
      ordinal: index,
      ...(chunk.page !== undefined ? { page: chunk.page as number } : {}),
      text: chunk.text,
    };
  });
  if (characters !== source.characterCount) fail(`${label} does not match its declared length`);

  return {
    source: {
      id: source.id,
      name: source.name,
      kind: source.kind as SourceRecord["kind"],
      size: source.size as number,
      contentHash: source.contentHash,
      ...(source.pageCount !== undefined ? { pageCount: source.pageCount as number } : {}),
      chunkCount: source.chunkCount,
      characterCount: source.characterCount as number,
      enabled: source.enabled,
      addedAt: source.addedAt,
    },
    chunks,
  };
}

function validateCitation(value: unknown, messageLabel: string): ChatCitation {
  if (!isRecord(value)) fail(`${messageLabel} has an invalid citation`);
  assertOnlyKeys(value, ["id", "origin", "locator", "text", "sourceId", "pageId", "objectId"], `${messageLabel} citation`);
  if (!isString(value.id, 200) || !isString(value.origin, 500) || typeof value.locator !== "string" || value.locator.length > 500 || !isString(value.text, MAX_CHUNK_CHARACTERS)) {
    fail(`${messageLabel} has an invalid citation`);
  }
  if (!isOptionalString(value.sourceId, 200) || !isOptionalString(value.pageId, 200) || !isOptionalString(value.objectId, 200)) fail(`${messageLabel} has an invalid citation reference`);
  return {
    id: value.id,
    origin: value.origin,
    locator: value.locator,
    text: value.text,
    ...(value.sourceId !== undefined ? { sourceId: value.sourceId as string } : {}),
    ...(value.pageId !== undefined ? { pageId: value.pageId as string } : {}),
    ...(value.objectId !== undefined ? { objectId: value.objectId as string } : {}),
  };
}

export function validateChatMessages(value: unknown): ChatMessageRecord[] {
  if (!Array.isArray(value) || value.length > MAX_ARCHIVED_CHAT_MESSAGES) fail("the chat history is invalid or too long");
  const ids = new Set<string>();
  return value.map((message): ChatMessageRecord => {
    if (!isRecord(message)) fail("the chat history contains a non-object entry");
    assertOnlyKeys(message, ["id", "role", "content", "createdAt", "citations", "incomplete", "provider", "model"], "chat message");
    if (!isString(message.id, 200) || ids.has(message.id)) fail("a chat message has a missing or duplicate id");
    ids.add(message.id);
    const label = `chat message ${message.id}`;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARACTERS || !isFiniteNumber(message.createdAt)) {
      fail(`${label} is malformed`);
    }
    if (message.incomplete !== undefined && typeof message.incomplete !== "boolean") fail(`${label} is malformed`);
    if (!isOptionalString(message.provider, 200) || !isOptionalString(message.model, 200)) fail(`${label} has invalid provider metadata`);
    if (message.citations !== undefined && (!Array.isArray(message.citations) || message.citations.length > MAX_CITATIONS)) fail(`${label} has too many citations`);
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.citations !== undefined ? { citations: (message.citations as unknown[]).map((citation) => validateCitation(citation, label)) } : {}),
      ...(message.incomplete !== undefined ? { incomplete: message.incomplete as boolean } : {}),
      ...(message.provider !== undefined ? { provider: message.provider as string } : {}),
      ...(message.model !== undefined ? { model: message.model as string } : {}),
    };
  });
}

/** Checks attempt records against the pages they claim to belong to; grading itself is kept as recorded. */
export function validateQuizAttempts(value: unknown, pageIds: ReadonlySet<string>): QuizAttemptRecord[] {
  if (!Array.isArray(value) || value.length > MAX_ARCHIVED_QUIZ_ATTEMPTS) fail("the quiz attempt list is invalid or too long");
  const ids = new Set<string>();
  return value.map((attempt): QuizAttemptRecord => {
    if (!isRecord(attempt)) fail("the quiz attempt list contains a non-object entry");
    assertOnlyKeys(attempt, ["id", "pageId", "quizId", "quizRevision", "chosenOptionId", "correct", "sequence", "answeredAt", "assistance"], "quiz attempt");
    if (!isString(attempt.id, 200) || ids.has(attempt.id)) fail("a quiz attempt has a missing or duplicate id");
    ids.add(attempt.id);
    if (!isString(attempt.pageId, 200) || !pageIds.has(attempt.pageId)) fail(`quiz attempt ${attempt.id} belongs to a page that is not in the archive`);
    if (!isString(attempt.quizId, 200) || !isString(attempt.chosenOptionId, 200) || typeof attempt.correct !== "boolean") fail(`quiz attempt ${attempt.id} is malformed`);
    if (!isPositiveInteger(attempt.quizRevision) || !isPositiveInteger(attempt.sequence) || !isFiniteNumber(attempt.answeredAt)) fail(`quiz attempt ${attempt.id} has an invalid version, sequence or time`);
    if (attempt.assistance !== undefined && attempt.assistance !== "hint" && attempt.assistance !== "revealed") fail(`quiz attempt ${attempt.id} has an invalid assistance value`);
    return {
      id: attempt.id,
      pageId: attempt.pageId,
      quizId: attempt.quizId,
      quizRevision: attempt.quizRevision,
      chosenOptionId: attempt.chosenOptionId,
      correct: attempt.correct,
      sequence: attempt.sequence,
      answeredAt: attempt.answeredAt,
      ...(attempt.assistance !== undefined ? { assistance: attempt.assistance as QuizAttemptRecord["assistance"] } : {}),
    };
  });
}

export function validateAiFeedback(value: unknown, pageIds: ReadonlySet<string>): AiFeedbackRecord[] {
  if (!Array.isArray(value) || value.length > MAX_ARCHIVED_AI_FEEDBACK) fail("the AI feedback list is invalid or too long");
  const ids = new Set<string>();
  return value.map((report): AiFeedbackRecord => {
    if (!isRecord(report)) fail("the AI feedback list contains a non-object entry");
    assertOnlyKeys(report, ["id", "pageId", "objectId", "objectRevision", "transactionId", "requestId", "intent", "provider", "model", "configurationId", "reason", "note", "contentSnapshot", "createdAt"], "AI feedback");
    if (!isString(report.id, 200) || ids.has(report.id)) fail("an AI feedback report has a missing or duplicate id");
    ids.add(report.id);
    const label = `AI feedback ${report.id}`;
    if (!isString(report.pageId, 200) || !pageIds.has(report.pageId)) fail(`${label} belongs to a page that is not in the archive`);
    for (const field of ["objectId", "transactionId", "requestId", "provider", "model", "configurationId"] as const) {
      if (!isString(report[field], 200)) fail(`${label} has an invalid ${field}`);
    }
    if (!AI_INTENTS.has(String(report.intent)) || !(String(report.reason) in AI_FEEDBACK_REASONS)) fail(`${label} has an invalid intent or reason`);
    if (!isPositiveInteger(report.objectRevision) || !isFiniteNumber(report.createdAt)) fail(`${label} has an invalid revision or time`);
    if (!isOptionalString(report.note, MAX_FEEDBACK_NOTE) || typeof report.contentSnapshot !== "string" || report.contentSnapshot.length > MAX_FEEDBACK_SNAPSHOT) fail(`${label} has invalid text`);
    return {
      id: report.id,
      pageId: report.pageId,
      objectId: report.objectId as string,
      objectRevision: report.objectRevision,
      transactionId: report.transactionId as string,
      requestId: report.requestId as string,
      intent: report.intent as AiFeedbackRecord["intent"],
      provider: report.provider as string,
      model: report.model as string,
      configurationId: report.configurationId as string,
      reason: report.reason as AiFeedbackRecord["reason"],
      ...(report.note ? { note: report.note as string } : {}),
      contentSnapshot: report.contentSnapshot,
      createdAt: report.createdAt,
    };
  });
}

/**
 * The library for an archive of one page: that page's quiz answers and AI
 * reports. Uploaded sources and the chat history belong to the whole notebook,
 * not to a page, so they travel only in a whole-notebook backup.
 */
export function pageArchiveLibrary(library: NotebookLibrary, pageId: string): NotebookLibrary {
  return {
    sources: [],
    chatMessages: [],
    quizAttempts: (library.quizAttempts ?? []).filter((attempt) => attempt.pageId === pageId),
    aiFeedback: (library.aiFeedback ?? []).filter((report) => report.pageId === pageId),
  };
}

export type LibraryRemap = {
  /** Allocates a fresh id with the given prefix that has not been used in this import. */
  allocate: (prefix: string) => string;
  /** Sources already on this device, by file hash; an archived copy of one is not stored twice. */
  existingSourceIdsByHash: ReadonlyMap<string, string>;
  pageIds: ReadonlyMap<string, string>;
  objectIdsByPage: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

/**
 * Gives every imported source and message a fresh identity and points each
 * citation at the imported copies. A citation whose page or object was not in
 * the archive keeps its quoted text but loses the link, rather than pointing
 * at an unrelated record on this device.
 */
export function remapLibrary(library: NotebookLibrary, remap: LibraryRemap): NotebookLibrary {
  const sourceIds = new Map<string, string>();
  const sources: ArchivedSource[] = [];
  for (const { source, chunks } of library.sources) {
    const existing = remap.existingSourceIdsByHash.get(source.contentHash);
    if (existing) {
      sourceIds.set(source.id, existing);
      continue;
    }
    const id = remap.allocate("source");
    sourceIds.set(source.id, id);
    sources.push({
      source: { ...structuredClone(source), id },
      chunks: chunks.map((chunk) => ({ ...structuredClone(chunk), id: `${id}:${chunk.ordinal}`, sourceId: id })),
    });
  }

  const chatMessages = library.chatMessages.map((message): ChatMessageRecord => ({
    ...structuredClone(message),
    id: remap.allocate("message"),
    ...(message.citations ? {
      citations: message.citations.map((citation) => {
        const { sourceId, pageId, objectId, ...rest } = citation;
        const nextSourceId = sourceId ? sourceIds.get(sourceId) : undefined;
        const nextPageId = pageId ? remap.pageIds.get(pageId) : undefined;
        const nextObjectId = pageId && objectId ? remap.objectIdsByPage.get(pageId)?.get(objectId) : undefined;
        return {
          ...rest,
          ...(nextSourceId ? { sourceId: nextSourceId } : {}),
          ...(nextPageId ? { pageId: nextPageId } : {}),
          ...(nextPageId && nextObjectId ? { objectId: nextObjectId } : {}),
        };
      }),
    } : {}),
  }));

  return { sources, chatMessages };
}
