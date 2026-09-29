/**
 * Splits extracted document text into passages small enough to retrieve and
 * send individually. Passages never cross a page boundary, so every citation
 * can name the exact page it came from.
 */

export type TextSegment = {
  /** 1-based page number for paginated formats; absent for plain text and Word documents. */
  page?: number;
  text: string;
};

export type TextChunk = {
  ordinal: number;
  page?: number;
  text: string;
};

export const TARGET_CHUNK_CHARACTERS = 1_200;
const MAX_CHUNK_CHARACTERS = 1_800;
const OVERLAP_CHARACTERS = 200;
const MIN_CHUNK_CHARACTERS = 20;

/** Collapses layout whitespace while keeping paragraph breaks, which carry meaning. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_CHARACTERS) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g) ?? [paragraph];
  const pieces: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK_CHARACTERS) {
      pieces.push(sentence);
      continue;
    }
    // A run with no sentence ends (a table, a formula dump) is cut on spaces.
    for (let start = 0; start < sentence.length; start += TARGET_CHUNK_CHARACTERS) {
      pieces.push(sentence.slice(start, start + TARGET_CHUNK_CHARACTERS));
    }
  }
  return pieces;
}

/** The tail of a passage repeated at the start of the next, cut at a word boundary. */
function overlapTail(text: string): string {
  if (text.length <= OVERLAP_CHARACTERS) return "";
  const tail = text.slice(-OVERLAP_CHARACTERS);
  const space = tail.indexOf(" ");
  return space === -1 ? "" : tail.slice(space + 1);
}

export function chunkSegments(segments: TextSegment[], maxChunks = Number.POSITIVE_INFINITY): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const segment of segments) {
    const normalized = normalizeExtractedText(segment.text);
    if (normalized.length === 0) continue;
    const pieces = normalized.split(/\n\n/).flatMap((paragraph) => splitLongParagraph(paragraph.replace(/\n/g, " ").trim()));

    let current = "";
    let carried = "";
    const flush = () => {
      const text = current.trim();
      const previous = chunks.at(-1);
      if (text.length > 0 && text.length < MIN_CHUNK_CHARACTERS && previous && previous.page === segment.page) {
        previous.text += ` ${text}`;
      } else if (text.length > 0) {
        chunks.push({ ordinal: chunks.length, page: segment.page, text });
      }
      carried = overlapTail(text);
      current = "";
    };

    for (const piece of pieces) {
      if (!piece) continue;
      const separator = current ? (current.endsWith(" ") ? "" : " ") : "";
      if (current && current.length + separator.length + piece.length > TARGET_CHUNK_CHARACTERS) {
        flush();
        if (chunks.length >= maxChunks) return chunks;
        current = carried ? `${carried} ` : "";
      }
      current += (current && !current.endsWith(" ") ? " " : "") + piece;
    }
    if (current.trim().length > carried.length) flush();
    if (chunks.length >= maxChunks) return chunks.slice(0, maxChunks);
  }
  return chunks;
}
