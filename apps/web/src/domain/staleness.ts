import type { AiTransactionRecord, NotebookObject } from "./notebook";

/**
 * Whether AI-generated content still describes what it was generated from.
 *
 * Revisions cannot answer that: moving or resizing a note bumps its revision
 * without changing what it says. So each source's meaning is fingerprinted —
 * everything except identity, revision, grouping and geometry — when the
 * request is made, and compared with the source as it is now.
 */

const NON_SEMANTIC_KEYS = new Set(["id", "revision", "groupId", "x", "y", "width", "height"]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The part of an object that carries meaning, in a form that does not depend on key order. */
export function semanticContentOf(object: NotebookObject): string {
  const content = Object.fromEntries(Object.entries(object).filter(([key]) => !NON_SEMANTIC_KEYS.has(key)));
  return stableStringify(content);
}

export async function contentHashOf(object: NotebookObject): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(semanticContentOf(object)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Source = AiTransactionRecord["sources"][number];

/** Adds the content hash of each source as it is now; a source missing from the page is left without one. */
export async function withContentHashes(sources: readonly Source[], objects: readonly NotebookObject[]): Promise<Source[]> {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return Promise.all(sources.map(async (source) => {
    const object = byId.get(source.id);
    return object ? { ...source, contentHash: await contentHashOf(object) } : { ...source };
  }));
}

export type StaleReason = "source-changed" | "source-deleted";
/** Why a generated object is stale, and which of its selected sources are still on the page to explain again. */
export type StaleGeneratedObject = { reason: StaleReason; sourceIds: string[] };

/**
 * The generated objects whose selected sources have changed meaning or gone.
 * Only sources the writer selected count: the nearby context sent alongside
 * them changes all the time and would flag nearly everything. Records from
 * before selection and hashes were kept are never flagged, since there is
 * nothing trustworthy to compare with.
 *
 * `currentHash` returns the hash of an object's content as it is now, or
 * undefined while it is still being computed; an unknown hash is not stale.
 */
export function findStaleGeneratedObjects(
  objects: readonly NotebookObject[],
  transactions: readonly AiTransactionRecord[],
  currentHash: (object: NotebookObject) => string | undefined,
): Map<string, StaleGeneratedObject> {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const stale = new Map<string, StaleGeneratedObject>();
  for (const transaction of transactions) {
    const basis = transaction.sources.filter((source) => source.selected && source.contentHash);
    if (basis.length === 0) continue;
    let reason: StaleReason | undefined;
    for (const source of basis) {
      const current = byId.get(source.id);
      if (!current) {
        reason = "source-deleted";
        break;
      }
      const hash = currentHash(current);
      if (hash !== undefined && hash !== source.contentHash) reason = "source-changed";
    }
    if (!reason) continue;
    const sourceIds = basis.map((source) => source.id).filter((id) => byId.has(id));
    for (const id of transaction.generatedObjectIds) if (byId.has(id)) stale.set(id, { reason, sourceIds });
  }
  return stale;
}

/** The objects whose current content hash the staleness check needs. */
export function selectedSourceIds(transactions: readonly AiTransactionRecord[]): Set<string> {
  return new Set(transactions.flatMap((transaction) => transaction.sources.filter((source) => source.selected && source.contentHash).map((source) => source.id)));
}
