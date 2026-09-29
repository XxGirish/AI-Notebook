import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";
import type { AiTransactionRecord, NotebookObject } from "../domain/notebook";
import { validateFixture } from "../domain/notebook";
import type { NotebookPage } from "../domain/pages";
import { isPaperStyle } from "../domain/paper";
import type { QuizAttemptRecord } from "../domain/quizAttempts";
import type { AiFeedbackRecord } from "../domain/aiFeedback";
import { archivedSourceDocument, MAX_ARCHIVED_SOURCES, remapLibrary, validateAiFeedback, validateArchivedSource, validateChatMessages, validateQuizAttempts, type ArchivedSource, type NotebookLibrary } from "./archiveLibrary";
import type { AssetRecord, ChatMessageRecord } from "./notebookDatabase";
import { CURRENT_PAGE_SCHEMA_VERSION, migratePersistedPage } from "./pageRecords";

/** Version 2 adds the library (uploaded sources and chat history). Version 1 archives still import. */
export const NOTEBOOK_ARCHIVE_VERSION = 2;
const SUPPORTED_ARCHIVE_VERSIONS = new Set([1, 2]);
export const NOTEBOOK_ARCHIVE_MIME = "application/vnd.ai-notebook+zip";
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1_400;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_OBJECTS_PER_PAGE = 25_000;

type ManifestPage = { id: string; title: string; path: string; sha256: string };
type ManifestAsset = { hash: string; path: string; mimeType: string; size: number };
type ManifestFile = { path: string; sha256: string };
type NotebookArchiveManifest = {
  format: "ai-notebook";
  archiveVersion: 1 | 2;
  documentSchemaVersion: 1 | 2 | 3 | 4;
  exportedAt: string;
  pages: ManifestPage[];
  assets: ManifestAsset[];
  sources?: ManifestFile[];
  chat?: ManifestFile;
  attempts?: ManifestFile;
  feedback?: ManifestFile;
};

export type ImportedNotebook = NotebookLibrary & {
  quizAttempts: QuizAttemptRecord[];
  aiFeedback: AiFeedbackRecord[];
  pages: NotebookPage[];
  assets: AssetRecord[];
};

export type ImportOptions = {
  now?: number;
  idFactory?: () => string;
  reservedPageIds?: ReadonlySet<string>;
  /** Sources already on this device, by file hash, so an archived copy is not stored twice. */
  existingSourceIdsByHash?: ReadonlyMap<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isString = (value: unknown, max = 100_000): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const BASE_OBJECT_KEYS = ["id", "revision", "groupId", "x", "y", "width", "height", "kind"];

function fail(message: string): never {
  throw new Error(`Invalid .ainotebook archive: ${message}`);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const allowedKeys = new Set(allowed);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) fail(`${label} contains unsupported field ${unknownKey}`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return fail(`${label} is not valid JSON`);
  }
}

function validateBaseObject(value: Record<string, unknown>) {
  if (!isString(value.id, 200) || !isString(value.kind, 50)) fail("a page contains an object without a valid id or kind");
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) fail(`object ${value.id} has an invalid revision`);
  for (const field of ["x", "y", "width", "height"] as const) {
    if (!isFiniteNumber(value[field])) fail(`object ${value.id} has invalid geometry`);
  }
  if ((value.width as number) < 0 || (value.height as number) < 0) fail(`object ${value.id} has negative dimensions`);
  if (value.groupId !== undefined && !isString(value.groupId, 200)) fail(`object ${value.id} has an invalid group id`);
}

function validateStroke(value: Record<string, unknown>) {
  assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "tool", "color", "size", "points"], `stroke ${value.id}`);
  if (value.tool !== "pen" && value.tool !== "highlighter") fail(`stroke ${value.id} has an invalid tool`);
  if (!isString(value.color, 100) || !isFiniteNumber(value.size) || value.size <= 0 || !Array.isArray(value.points) || value.points.length > 100_000) {
    fail(`stroke ${value.id} is malformed`);
  }
  for (const point of value.points) {
    if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y) || !isFiniteNumber(point.pressure) || !isFiniteNumber(point.time)) {
      fail(`stroke ${value.id} contains an invalid point`);
    }
    assertOnlyKeys(point, ["x", "y", "pressure", "time"], `stroke ${value.id} point`);
  }
}

function validateObject(value: unknown): NotebookObject {
  if (!isRecord(value)) fail("a page contains a non-object entry");
  validateBaseObject(value);

  switch (value.kind) {
    case "stroke":
      validateStroke(value);
      break;
    case "ink-text": {
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "text", "fontSize", "color", "recognizedText", "recognizer", "sourceStrokes"], `handwriting text ${value.id}`);
      if (!isString(value.text, 2_000) || typeof value.recognizedText !== "string" || value.recognizedText.length > 2_000 || !isString(value.recognizer, 200) || !isString(value.color, 100)) {
        fail(`handwriting text ${value.id} is malformed`);
      }
      if (!isFiniteNumber(value.fontSize) || value.fontSize <= 0 || value.fontSize > 1_000) fail(`handwriting text ${value.id} has an invalid font size`);
      if (!Array.isArray(value.sourceStrokes) || value.sourceStrokes.length === 0 || value.sourceStrokes.length > 2_000) fail(`handwriting text ${value.id} has invalid source ink`);
      for (const stroke of value.sourceStrokes) {
        if (!isRecord(stroke)) fail(`handwriting text ${value.id} has invalid source ink`);
        validateBaseObject(stroke);
        if (stroke.kind !== "stroke") fail(`handwriting text ${value.id} has invalid source ink`);
        validateStroke(stroke);
      }
      break;
    }
    case "text":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "text", "fontSize", "color"], `text ${value.id}`);
      if (!isString(value.text, 10_000) || !isString(value.color, 100)) fail(`text ${value.id} is malformed`);
      if (!isFiniteNumber(value.fontSize) || value.fontSize <= 0 || value.fontSize > 1_000) fail(`text ${value.id} has an invalid font size`);
      break;
    case "text-card":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "title", "body"], `text card ${value.id}`);
      if (!isString(value.title, 10_000) || typeof value.body !== "string" || value.body.length > 200_000) fail(`text card ${value.id} is malformed`);
      break;
    case "equation-card":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "title", "latex"], `equation card ${value.id}`);
      if (!isString(value.title, 10_000) || !isString(value.latex, 50_000)) fail(`equation card ${value.id} is malformed`);
      break;
    case "graph-node":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "label"], `graph node ${value.id}`);
      if (!isString(value.label, 20_000)) fail(`graph node ${value.id} is malformed`);
      break;
    case "shape":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "shape", "fill", "stroke"], `shape ${value.id}`);
      if ((value.shape !== "rectangle" && value.shape !== "ellipse") || !isString(value.fill, 100) || !isString(value.stroke, 100)) fail(`shape ${value.id} is malformed`);
      break;
    case "image":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "assetHash", "mimeType", "name"], `image ${value.id}`);
      if (!isHash(value.assetHash) || !isString(value.mimeType, 200) || !isString(value.name, 500)) fail(`image ${value.id} is malformed`);
      break;
    case "connector":
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "fromId", "toId", "label"], `connector ${value.id}`);
      if (!isString(value.fromId, 200) || !isString(value.toId, 200) || (value.label !== undefined && typeof value.label !== "string")) fail(`connector ${value.id} is malformed`);
      break;
    case "quiz-card": {
      assertOnlyKeys(value, [...BASE_OBJECT_KEYS, "prompt", "options", "correctOptionId", "rationale"], `quiz ${value.id}`);
      if (!isString(value.prompt, 50_000) || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 20 || !isString(value.correctOptionId, 200) || !isString(value.rationale, 100_000)) {
        fail(`quiz ${value.id} is malformed`);
      }
      const optionIds = new Set<string>();
      for (const option of value.options) {
        if (!isRecord(option) || !isString(option.id, 200) || !isString(option.label, 20_000) || optionIds.has(option.id)) fail(`quiz ${value.id} has invalid options`);
        assertOnlyKeys(option, ["id", "label"], `quiz ${value.id} option`);
        optionIds.add(option.id);
      }
      break;
    }
    default:
      fail(`unsupported object kind: ${String(value.kind)}`);
  }

  return structuredClone(value) as NotebookObject;
}

const AI_INTENTS = new Set(["teach_section", "explain_selection", "create_diagram", "create_equation", "create_quiz", "chat_answer"]);

function validateAiTransaction(value: unknown): AiTransactionRecord {
  if (!isRecord(value)) fail("a page contains a non-object AI transaction");
  assertOnlyKeys(value, ["transactionId", "requestId", "intent", "provider", "model", "configurationId", "proposalSchemaVersion", "sources", "committedAt", "generatedObjectIds", "updatedObjectIds"], "AI transaction");
  if (!isString(value.transactionId, 200) || !isString(value.requestId, 200) || !AI_INTENTS.has(String(value.intent)) || !isString(value.provider, 200) || !isString(value.model, 200) || !isString(value.configurationId, 200)) {
    fail("an AI transaction has invalid identity metadata");
  }
  if (!Number.isInteger(value.proposalSchemaVersion) || (value.proposalSchemaVersion as number) < 1 || !isFiniteNumber(value.committedAt)) fail(`AI transaction ${value.transactionId} has an invalid version or timestamp`);
  if (!Array.isArray(value.sources) || value.sources.length > 200 || !Array.isArray(value.generatedObjectIds) || value.generatedObjectIds.length > 1_000 || !Array.isArray(value.updatedObjectIds) || value.updatedObjectIds.length > 1_000) {
    fail(`AI transaction ${value.transactionId} has too many or invalid references`);
  }
  const sources = value.sources.map((source) => {
    if (!isRecord(source) || !isString(source.id, 200) || !Number.isInteger(source.revision) || (source.revision as number) < 1 || (source.contentHash !== undefined && !isHash(source.contentHash)) || (source.selected !== undefined && source.selected !== true)) {
      fail(`AI transaction ${value.transactionId} has an invalid source`);
    }
    assertOnlyKeys(source, ["id", "revision", "contentHash", "selected"], `AI transaction ${value.transactionId} source`);
    return {
      id: source.id,
      revision: source.revision as number,
      contentHash: source.contentHash as string | undefined,
      ...(source.selected ? { selected: true } : {}),
    };
  });
  const readIds = (ids: unknown[], label: string) => {
    if (!ids.every((id) => isString(id, 200)) || new Set(ids).size !== ids.length) fail(`AI transaction ${value.transactionId} has invalid ${label}`);
    return ids as string[];
  };
  return {
    transactionId: value.transactionId,
    requestId: value.requestId,
    intent: value.intent as AiTransactionRecord["intent"],
    provider: value.provider,
    model: value.model,
    configurationId: value.configurationId,
    proposalSchemaVersion: value.proposalSchemaVersion as number,
    sources,
    committedAt: value.committedAt,
    generatedObjectIds: readIds(value.generatedObjectIds, "generated object IDs"),
    updatedObjectIds: readIds(value.updatedObjectIds, "updated object IDs"),
  };
}

function validatePage(value: unknown, expectedSchemaVersion?: number): NotebookPage {
  if (!isRecord(value)) fail("a page record is not an object");
  if (!Number.isInteger(value.schemaVersion) || (value.schemaVersion as number) < 1 || (value.schemaVersion as number) > CURRENT_PAGE_SCHEMA_VERSION || (expectedSchemaVersion !== undefined && value.schemaVersion !== expectedSchemaVersion)) fail("a page uses an unsupported document schema");
  const pageSchemaVersion = value.schemaVersion as number;
  assertOnlyKeys(value, ["schemaVersion", "id", "title", "width", "height", "paper", "objects", "createdAt", "updatedAt", ...(pageSchemaVersion >= 2 ? ["aiTransactions"] : [])], "page record");
  if (value.paper !== undefined && !isPaperStyle(value.paper)) fail(`page ${String(value.id)} has an unknown paper style`);
  if (!isString(value.id, 200) || !isString(value.title, 10_000)) fail("a page has an invalid id or title");
  if (!isFiniteNumber(value.width) || value.width <= 0 || !isFiniteNumber(value.height) || value.height <= 0) fail(`page ${value.id} has invalid dimensions`);
  if (!isFiniteNumber(value.createdAt) || !isFiniteNumber(value.updatedAt)) fail(`page ${value.id} has invalid timestamps`);
  if (!Array.isArray(value.objects) || value.objects.length > MAX_OBJECTS_PER_PAGE) fail(`page ${value.id} has too many objects`);

  if (pageSchemaVersion >= 2 && (!Array.isArray(value.aiTransactions) || value.aiTransactions.length > 10_000)) fail(`page ${value.id} has an invalid AI transaction list`);
  const page = migratePersistedPage({
    ...value,
    objects: value.objects.map(validateObject),
    ...(pageSchemaVersion >= 2 ? { aiTransactions: (value.aiTransactions as unknown[]).map(validateAiTransaction) } : {}),
  });
  const errors = validateFixture(page);
  if (errors.length > 0) fail(errors[0]);
  return page;
}

function parseManifestFile(value: unknown, expectedPath: string, label: string): ManifestFile {
  if (!isRecord(value) || value.path !== expectedPath || !isHash(value.sha256)) fail(`${label} manifest entry is invalid`);
  assertOnlyKeys(value, ["path", "sha256"], `${label} manifest entry`);
  return { path: value.path, sha256: value.sha256 };
}

function parseManifest(value: unknown): NotebookArchiveManifest {
  if (!isRecord(value) || value.format !== "ai-notebook" || !SUPPORTED_ARCHIVE_VERSIONS.has(value.archiveVersion as number)) fail("the manifest version is unsupported");
  const archiveVersion = value.archiveVersion as 1 | 2;
  assertOnlyKeys(value, ["format", "archiveVersion", "documentSchemaVersion", "exportedAt", "pages", "assets", ...(archiveVersion >= 2 ? ["sources", "chat", "attempts", "feedback"] : [])], "manifest");
  if (!Number.isInteger(value.documentSchemaVersion) || (value.documentSchemaVersion as number) < 1 || (value.documentSchemaVersion as number) > CURRENT_PAGE_SCHEMA_VERSION) fail("the document schema version is unsupported");
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) fail("the export timestamp is invalid");
  if (!Array.isArray(value.pages) || value.pages.length === 0 || value.pages.length > MAX_PAGES) fail("the page list is invalid");
  if (!Array.isArray(value.assets)) fail("the asset list is invalid");

  const pages = value.pages.map((entry, index): ManifestPage => {
    const expectedPath = `pages/${String(index).padStart(4, "0")}.json`;
    if (!isRecord(entry) || !isString(entry.id, 200) || !isString(entry.title, 10_000) || entry.path !== expectedPath || !isHash(entry.sha256)) fail("a page manifest entry is invalid");
    assertOnlyKeys(entry, ["id", "title", "path", "sha256"], "page manifest entry");
    return { id: entry.id, title: entry.title, path: entry.path, sha256: entry.sha256 };
  });
  if (new Set(pages.map((page) => page.id)).size !== pages.length) fail("the manifest contains duplicate page ids");

  const assets = value.assets.map((entry): ManifestAsset => {
    if (!isRecord(entry) || !isHash(entry.hash) || entry.path !== `assets/${entry.hash}` || !isString(entry.mimeType, 200) || !Number.isInteger(entry.size) || (entry.size as number) < 0 || (entry.size as number) > MAX_ASSET_BYTES) {
      fail("an asset manifest entry is invalid");
    }
    assertOnlyKeys(entry, ["hash", "path", "mimeType", "size"], "asset manifest entry");
    return { hash: entry.hash, path: entry.path, mimeType: entry.mimeType, size: entry.size as number };
  });
  if (new Set(assets.map((asset) => asset.hash)).size !== assets.length) fail("the manifest contains duplicate assets");

  if (value.sources !== undefined && (!Array.isArray(value.sources) || value.sources.length > MAX_ARCHIVED_SOURCES)) fail("the source list is invalid");
  const sources = (value.sources as unknown[] | undefined)?.map((entry, index) => parseManifestFile(entry, sourcePath(index), "a source"));
  const chat = value.chat === undefined ? undefined : parseManifestFile(value.chat, CHAT_PATH, "the chat");
  const attempts = value.attempts === undefined ? undefined : parseManifestFile(value.attempts, ATTEMPTS_PATH, "the quiz attempts");
  const feedback = value.feedback === undefined ? undefined : parseManifestFile(value.feedback, FEEDBACK_PATH, "the AI feedback");

  return {
    format: "ai-notebook",
    archiveVersion,
    documentSchemaVersion: value.documentSchemaVersion as 1 | 2 | 3 | 4,
    exportedAt: value.exportedAt,
    pages,
    assets,
    ...(sources ? { sources } : {}),
    ...(chat ? { chat } : {}),
    ...(attempts ? { attempts } : {}),
    ...(feedback ? { feedback } : {}),
  };
}

const sourcePath = (index: number) => `sources/${String(index).padStart(4, "0")}.json`;
const CHAT_PATH = "chat.json";
const ATTEMPTS_PATH = "attempts.json";
const FEEDBACK_PATH = "feedback.json";
const EMPTY_LIBRARY: NotebookLibrary = { sources: [], chatMessages: [] };

function referencedAssetHashes(pages: NotebookPage[]): Set<string> {
  return new Set(pages.flatMap((page) => page.objects.filter((object) => object.kind === "image").map((object) => object.assetHash)));
}

function allocateId(prefix: string, used: Set<string>, idFactory: () => string): string {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const candidate = `${prefix}-${idFactory()}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return fail("unique ids could not be allocated for the imported copy");
}

export async function createNotebookArchive(
  pages: NotebookPage[],
  assets: AssetRecord[],
  exportedAt = new Date().toISOString(),
  library: NotebookLibrary = EMPTY_LIBRARY,
): Promise<Uint8Array> {
  if (pages.length === 0 || pages.length > MAX_PAGES) fail("there must be between 1 and 500 pages");
  const validatedPages = pages.map((page) => validatePage(page));
  if (new Set(validatedPages.map((page) => page.id)).size !== validatedPages.length) fail("page ids must be unique");

  const requestedHashes = referencedAssetHashes(validatedPages);
  const assetByHash = new Map(assets.map((asset) => [asset.hash, asset]));
  for (const image of validatedPages.flatMap((page) => page.objects).filter((object) => object.kind === "image")) {
    const asset = assetByHash.get(image.assetHash);
    if (asset && image.mimeType !== asset.mimeType) fail(`image ${image.id} does not match its asset type`);
  }
  const files: Record<string, Uint8Array> = {};
  const manifestPages: ManifestPage[] = [];
  const manifestAssets: ManifestAsset[] = [];

  for (const [index, page] of validatedPages.entries()) {
    const path = `pages/${String(index).padStart(4, "0")}.json`;
    const bytes = strToU8(JSON.stringify(page));
    if (bytes.length > MAX_PAGE_BYTES) fail(`page ${page.title} exceeds the archive size limit`);
    files[path] = bytes;
    manifestPages.push({ id: page.id, title: page.title, path, sha256: await sha256(bytes) });
  }

  for (const hash of [...requestedHashes].sort()) {
    const asset = assetByHash.get(hash);
    if (!asset) fail(`referenced asset ${hash} is missing`);
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    if (bytes.length !== asset.size || bytes.length > MAX_ASSET_BYTES || await sha256(bytes) !== hash) fail(`asset ${hash} failed integrity validation`);
    const path = `assets/${hash}`;
    files[path] = bytes;
    manifestAssets.push({ hash, path, mimeType: asset.mimeType, size: bytes.length });
  }

  // The library is validated in its archive form, exactly as an import will
  // read it, so an export never produces a file this app would then refuse.
  if (library.sources.length > MAX_ARCHIVED_SOURCES) fail(`there can be at most ${MAX_ARCHIVED_SOURCES} sources`);
  const manifestSources: ManifestFile[] = [];
  for (const [index, entry] of library.sources.entries()) {
    const document = archivedSourceDocument(entry);
    validateArchivedSource(document);
    const bytes = strToU8(JSON.stringify(document));
    if (bytes.length > MAX_ASSET_BYTES) fail(`source ${entry.source.name} exceeds the archive size limit`);
    const path = sourcePath(index);
    files[path] = bytes;
    manifestSources.push({ path, sha256: await sha256(bytes) });
  }
  const chatBytes = strToU8(JSON.stringify(validateChatMessages(structuredClone(library.chatMessages))));
  if (chatBytes.length > MAX_ASSET_BYTES) fail("the chat history exceeds the archive size limit");
  files[CHAT_PATH] = chatBytes;
  // Attempts go with the pages being exported; any left behind by a page
  // deleted in another tab have nothing to belong to.
  const exportedPageIds = new Set(validatedPages.map((page) => page.id));
  const attempts = validateQuizAttempts(structuredClone((library.quizAttempts ?? []).filter((attempt) => exportedPageIds.has(attempt.pageId))), exportedPageIds);
  const attemptBytes = strToU8(JSON.stringify(attempts));
  if (attemptBytes.length > MAX_ASSET_BYTES) fail("the quiz attempts exceed the archive size limit");
  files[ATTEMPTS_PATH] = attemptBytes;
  const feedbackBytes = strToU8(JSON.stringify(validateAiFeedback(structuredClone((library.aiFeedback ?? []).filter((report) => exportedPageIds.has(report.pageId))), exportedPageIds)));
  if (feedbackBytes.length > MAX_ASSET_BYTES) fail("the AI feedback exceeds the archive size limit");
  files[FEEDBACK_PATH] = feedbackBytes;

  const manifest: NotebookArchiveManifest = {
    format: "ai-notebook",
    archiveVersion: NOTEBOOK_ARCHIVE_VERSION,
    documentSchemaVersion: CURRENT_PAGE_SCHEMA_VERSION,
    exportedAt,
    pages: manifestPages,
    assets: manifestAssets,
    sources: manifestSources,
    chat: { path: CHAT_PATH, sha256: await sha256(chatBytes) },
    attempts: { path: ATTEMPTS_PATH, sha256: await sha256(attemptBytes) },
    feedback: { path: FEEDBACK_PATH, sha256: await sha256(feedbackBytes) },
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 6 });
}

function safelyUnzip(bytes: Uint8Array): Unzipped {
  if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) fail("the compressed file exceeds the size limit");
  let entryCount = 0;
  let expandedBytes = 0;
  try {
    return unzipSync(bytes, {
      filter: (entry) => {
        entryCount += 1;
        expandedBytes += entry.originalSize;
        if (entryCount > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES || entry.originalSize > MAX_ASSET_BYTES) {
          fail("the expanded file exceeds the safety limits");
        }
        if (entry.name.includes("\\") || entry.name.startsWith("/") || entry.name.split("/").includes("..")) fail("the archive contains an unsafe path");
        return !entry.name.endsWith("/");
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid .ainotebook archive:")) throw error;
    return fail("the ZIP data is corrupt or unsupported");
  }
}

export async function readNotebookArchive(bytes: Uint8Array, options: ImportOptions = {}): Promise<ImportedNotebook> {
  const {
    now = Date.now(),
    idFactory = () => crypto.randomUUID(),
    reservedPageIds = new Set<string>(),
    existingSourceIdsByHash = new Map<string, string>(),
  } = options;
  const files = safelyUnzip(bytes);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes || manifestBytes.length > 512 * 1024) fail("manifest.json is missing or too large");
  const manifest = parseManifest(parseJson(manifestBytes, "manifest.json"));

  const expectedPaths = new Set([
    "manifest.json",
    ...manifest.pages.map((page) => page.path),
    ...manifest.assets.map((asset) => asset.path),
    ...(manifest.sources ?? []).map((source) => source.path),
    ...(manifest.chat ? [manifest.chat.path] : []),
    ...(manifest.attempts ? [manifest.attempts.path] : []),
    ...(manifest.feedback ? [manifest.feedback.path] : []),
  ]);
  for (const path of Object.keys(files)) if (!expectedPaths.has(path)) fail(`unexpected archive entry: ${path}`);
  if (Object.keys(files).length !== expectedPaths.size) fail("one or more manifest entries are missing");

  const sourcePages: NotebookPage[] = [];
  for (const pageEntry of manifest.pages) {
    const pageBytes = files[pageEntry.path];
    if (!pageBytes || pageBytes.length > MAX_PAGE_BYTES || await sha256(pageBytes) !== pageEntry.sha256) fail(`page ${pageEntry.title} failed integrity validation`);
    const page = validatePage(parseJson(pageBytes, pageEntry.path), manifest.documentSchemaVersion);
    if (page.id !== pageEntry.id || page.title !== pageEntry.title) fail(`page ${pageEntry.title} does not match its manifest entry`);
    sourcePages.push(page);
  }

  const sourceAssets: AssetRecord[] = [];
  for (const assetEntry of manifest.assets) {
    const assetBytes = files[assetEntry.path];
    if (!assetBytes || assetBytes.length !== assetEntry.size || await sha256(assetBytes) !== assetEntry.hash) fail(`asset ${assetEntry.hash} failed integrity validation`);
    sourceAssets.push({
      hash: assetEntry.hash,
      blob: new Blob([assetBytes], { type: assetEntry.mimeType }),
      mimeType: assetEntry.mimeType,
      size: assetEntry.size,
      createdAt: now,
    });
  }

  const readVerifiedJson = async (entry: ManifestFile, label: string) => {
    const entryBytes = files[entry.path];
    if (!entryBytes || await sha256(entryBytes) !== entry.sha256) fail(`${label} failed integrity validation`);
    return parseJson(entryBytes, entry.path);
  };
  const archivedSources: ArchivedSource[] = [];
  for (const entry of manifest.sources ?? []) archivedSources.push(validateArchivedSource(await readVerifiedJson(entry, entry.path)));
  if (new Set(archivedSources.map((entry) => entry.source.id)).size !== archivedSources.length) fail("the archive contains duplicate source ids");
  const archivedChat: ChatMessageRecord[] = manifest.chat ? validateChatMessages(await readVerifiedJson(manifest.chat, "the chat history")) : [];
  const archivedAttempts = manifest.attempts
    ? validateQuizAttempts(await readVerifiedJson(manifest.attempts, "the quiz attempts"), new Set(sourcePages.map((page) => page.id)))
    : [];
  const archivedFeedback = manifest.feedback
    ? validateAiFeedback(await readVerifiedJson(manifest.feedback, "the AI feedback"), new Set(sourcePages.map((page) => page.id)))
    : [];

  const usedAssets = referencedAssetHashes(sourcePages);
  const archivedAssets = new Set(sourceAssets.map((asset) => asset.hash));
  for (const hash of usedAssets) if (!archivedAssets.has(hash)) fail(`referenced asset ${hash} is missing`);
  for (const hash of archivedAssets) if (!usedAssets.has(hash)) fail(`asset ${hash} is not referenced by any page`);
  const assetTypeByHash = new Map(sourceAssets.map((asset) => [asset.hash, asset.mimeType]));
  const mismatchedImage = sourcePages.flatMap((page) => page.objects).find((object) => object.kind === "image" && assetTypeByHash.get(object.assetHash) !== object.mimeType);
  if (mismatchedImage) fail(`image ${mismatchedImage.id} does not match its asset type`);

  const usedPageIds = new Set(reservedPageIds);
  const pageIdMap = new Map<string, string>();
  const objectIdsByPage = new Map<string, Map<string, string>>();
  const remapAttemptByPage = new Map<string, (attempt: QuizAttemptRecord) => QuizAttemptRecord>();
  const remapFeedbackByPage = new Map<string, (report: AiFeedbackRecord) => AiFeedbackRecord>();
  const pages = sourcePages.map((page, pageIndex): NotebookPage => {
    const usedObjectIds = new Set<string>();
    const usedGroupIds = new Set<string>();
    const usedOptionIds = new Set<string>();
    const usedTransactionIds = new Set<string>();
    const objectIds = new Map(page.objects.map((object) => [object.id, allocateId("object", usedObjectIds, idFactory)]));
    objectIdsByPage.set(page.id, objectIds);
    const optionIdsByQuiz = new Map<string, Map<string, string>>();
    const groupIds = new Map([...new Set(page.objects.flatMap((object) => object.groupId ? [object.groupId] : []))].map((groupId) => [groupId, allocateId("group", usedGroupIds, idFactory)]));
    const objects = page.objects.map((object): NotebookObject => {
      const remappedBase = { id: objectIds.get(object.id)!, groupId: object.groupId ? groupIds.get(object.groupId) : undefined };
      if (object.kind === "connector") return { ...structuredClone(object), ...remappedBase, fromId: objectIds.get(object.fromId)!, toId: objectIds.get(object.toId)! };
      if (object.kind === "quiz-card") {
        const optionIds = new Map(object.options.map((option) => [option.id, allocateId("option", usedOptionIds, idFactory)]));
        optionIdsByQuiz.set(object.id, optionIds);
        return {
          ...structuredClone(object),
          ...remappedBase,
          options: object.options.map((option) => ({ ...option, id: optionIds.get(option.id)! })),
          correctOptionId: optionIds.get(object.correctOptionId)!,
        };
      }
      return { ...structuredClone(object), ...remappedBase } as NotebookObject;
    });
    const historicalObjectIds = new Map<string, string>();
    const remapObjectReference = (id: string) => objectIds.get(id) ?? (() => {
      const existing = historicalObjectIds.get(id);
      if (existing) return existing;
      const allocated = allocateId("historical-object", usedObjectIds, idFactory);
      historicalObjectIds.set(id, allocated);
      return allocated;
    })();
    const transactionIds = new Map<string, string>();
    const remapTransactionId = (id: string) => transactionIds.get(id) ?? (() => {
      const allocated = allocateId("transaction", usedTransactionIds, idFactory);
      transactionIds.set(id, allocated);
      return allocated;
    })();
    const aiTransactions = page.aiTransactions.map((transaction): AiTransactionRecord => ({
      ...structuredClone(transaction),
      transactionId: remapTransactionId(transaction.transactionId),
      sources: transaction.sources.map((source) => ({ ...source, id: remapObjectReference(source.id) })),
      generatedObjectIds: transaction.generatedObjectIds.map(remapObjectReference),
      updatedObjectIds: transaction.updatedObjectIds.map(remapObjectReference),
    }));
    const pageId = allocateId("page", usedPageIds, idFactory);
    pageIdMap.set(page.id, pageId);
    // An attempt may name a quiz, or an option, that has since been deleted or
    // edited away. It keeps a consistent stand-in id rather than being dropped,
    // so undoing the deletion elsewhere is not needed to keep the history.
    const historicalOptionIds = new Map<string, string>();
    remapAttemptByPage.set(page.id, (attempt) => {
      const optionKey = `${attempt.quizId}\u0000${attempt.chosenOptionId}`;
      const chosenOptionId = optionIdsByQuiz.get(attempt.quizId)?.get(attempt.chosenOptionId) ?? historicalOptionIds.get(optionKey) ?? (() => {
        const allocated = allocateId("historical-option", usedOptionIds, idFactory);
        historicalOptionIds.set(optionKey, allocated);
        return allocated;
      })();
      return { ...attempt, pageId, quizId: remapObjectReference(attempt.quizId), chosenOptionId };
    });
    remapFeedbackByPage.set(page.id, (report) => ({
      ...report,
      pageId,
      objectId: remapObjectReference(report.objectId),
      transactionId: remapTransactionId(report.transactionId),
    }));
    return {
      ...page,
      id: pageId,
      objects,
      aiTransactions,
      createdAt: now + pageIndex,
      updatedAt: now + pageIndex,
    };
  });

  const usedLibraryIds = new Set<string>();
  const library = remapLibrary({ sources: archivedSources, chatMessages: archivedChat }, {
    allocate: (prefix) => allocateId(prefix, usedLibraryIds, idFactory),
    existingSourceIdsByHash,
    pageIds: pageIdMap,
    objectIdsByPage,
  });
  const quizAttempts = archivedAttempts.map((attempt) => ({
    ...remapAttemptByPage.get(attempt.pageId)!(attempt),
    id: allocateId("attempt", usedLibraryIds, idFactory),
  }));

  const aiFeedback = archivedFeedback.map((report) => ({
    ...remapFeedbackByPage.get(report.pageId)!(report),
    id: allocateId("feedback", usedLibraryIds, idFactory),
  }));

  return { pages, assets: sourceAssets, ...library, quizAttempts, aiFeedback };
}
