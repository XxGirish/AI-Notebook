import { findSourceByHash, storeSource, type SourceChunkRecord, type SourceRecord } from "../persistence/notebookDatabase";
import { chunkSegments } from "./chunkText";
import { extractSourceText, SourceExtractionError } from "./extractText";

/** About 6 million characters: a long textbook, and well inside browser storage. */
export const MAX_CHUNKS_PER_SOURCE = 5_000;

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type AddSourceResult =
  | { status: "added"; source: SourceRecord; chunks: SourceChunkRecord[] }
  | { status: "duplicate"; source: SourceRecord };

/**
 * Extracts, splits and stores one uploaded file. Only its text is kept. A file
 * with no text layer, such as a scanned PDF, is refused with a reason instead
 * of being stored as an empty source the chat could never use.
 */
export async function addSourceFile(file: File, onProgress?: (fraction: number) => void): Promise<AddSourceResult> {
  const contentHash = await sha256Hex(await file.arrayBuffer());
  const existing = await findSourceByHash(contentHash);
  if (existing) return { status: "duplicate", source: existing };

  const extracted = await extractSourceText(file, onProgress);
  const chunks = chunkSegments(extracted.segments, MAX_CHUNKS_PER_SOURCE);
  if (chunks.length === 0) {
    throw new SourceExtractionError(extracted.kind === "pdf"
      ? "No text was found in this PDF. It may be scanned images, which are not supported yet."
      : "No text was found in this file.");
  }

  const id = `source-${crypto.randomUUID()}`;
  const records: SourceChunkRecord[] = chunks.map((chunk) => ({
    id: `${id}:${chunk.ordinal}`,
    sourceId: id,
    ordinal: chunk.ordinal,
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    text: chunk.text,
  }));
  const source: SourceRecord = {
    id,
    name: file.name.slice(0, 200) || "Untitled source",
    kind: extracted.kind,
    size: file.size,
    contentHash,
    ...(extracted.pageCount !== undefined ? { pageCount: extracted.pageCount } : {}),
    chunkCount: records.length,
    characterCount: records.reduce((total, chunk) => total + chunk.text.length, 0),
    enabled: true,
    addedAt: Date.now(),
  };
  await storeSource(source, records);
  return { status: "added", source, chunks: records };
}
