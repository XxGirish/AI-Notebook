import type { NotebookObject } from "../domain/notebook";
import type { NotebookPage } from "../domain/pages";

/**
 * A page is stored as one small metadata row plus one row per object, so that
 * saving a stroke costs the changed objects rather than the whole notebook page
 * (see docs/decisions/0009-incremental-page-persistence.md). This module holds
 * the pure part: splitting a page into rows, putting one back together, working
 * out what one save changed, and turning that into the record needed to undo it.
 *
 * Change detection is object identity. The document model is persistent: every
 * command produces new objects for what it touched and keeps the references of
 * everything else (domain/history.ts compares the same way), so an unchanged
 * reference means unchanged content.
 */

/** A page row without its objects. `objectIds` carries the document order. */
export type PageMetadataRecord = Omit<NotebookPage, "objects"> & { objectIds: string[] };

/** One stored object. `kind` is lifted out of the object so it can be indexed. */
export type PageObjectRecord = {
  pageId: string;
  objectId: string;
  kind: NotebookObject["kind"];
  object: NotebookObject;
};

/** Dexie key for one object row. */
export type PageObjectKey = [pageId: string, objectId: string];

/** What one save changes in the object table. */
export type PageObjectWrites = {
  puts: PageObjectRecord[];
  deletes: PageObjectKey[];
};

/**
 * The one recoverable prior state of a page, stored as the change that returns
 * to it: the metadata as it was, and only the objects that the save altered.
 * `null` means the object did not exist yet.
 */
export type PageRecoveryPatch = {
  pageId: string;
  capturedAt: number;
  metadata: PageMetadataRecord;
  objects: Record<string, NotebookObject | null>;
};

export class DuplicateObjectIdError extends Error {
  constructor(pageId: string, objectId: string) {
    super(`Page ${pageId} contains more than one object with id ${objectId}`);
    this.name = "DuplicateObjectIdError";
  }
}

export function objectMapOf(objects: Iterable<NotebookObject>): Map<string, NotebookObject> {
  const map = new Map<string, NotebookObject>();
  for (const object of objects) map.set(object.id, object);
  return map;
}

export function splitPage(page: NotebookPage): { metadata: PageMetadataRecord; objects: PageObjectRecord[] } {
  const { objects, ...rest } = page;
  const seen = new Set<string>();
  const rows = objects.map((object) => {
    if (seen.has(object.id)) throw new DuplicateObjectIdError(page.id, object.id);
    seen.add(object.id);
    return { pageId: page.id, objectId: object.id, kind: object.kind, object };
  });
  return { metadata: { ...rest, objectIds: rows.map((row) => row.objectId) }, objects: rows };
}

/**
 * Rebuilds a page in document order. Rows whose id the metadata no longer lists
 * are ignored; the next save that reads the table removes them.
 */
export function assemblePage(metadata: PageMetadataRecord, rows: Iterable<PageObjectRecord>): NotebookPage {
  const { objectIds, ...rest } = metadata;
  const byId = new Map<string, NotebookObject>();
  for (const row of rows) byId.set(row.objectId, row.object);
  const objects = objectIds.map((objectId) => {
    const object = byId.get(objectId);
    if (!object) throw new Error(`Stored page ${metadata.id} is missing object ${objectId}`);
    return object;
  });
  return { ...rest, objects };
}

export function diffPageObjects(
  pageId: string,
  previous: ReadonlyMap<string, NotebookObject>,
  next: readonly NotebookObject[],
): PageObjectWrites {
  const puts: PageObjectRecord[] = [];
  const nextIds = new Set<string>();
  for (const object of next) {
    if (nextIds.has(object.id)) throw new DuplicateObjectIdError(pageId, object.id);
    nextIds.add(object.id);
    if (previous.get(object.id) === object) continue;
    puts.push({ pageId, objectId: object.id, kind: object.kind, object });
  }

  const deletes: PageObjectKey[] = [];
  for (const objectId of previous.keys()) {
    if (!nextIds.has(objectId)) deletes.push([pageId, objectId]);
  }
  return { puts, deletes };
}

/** The record that undoes `writes`, given the state they were computed against. */
export function recoveryPatchFor(
  previousMetadata: PageMetadataRecord,
  previous: ReadonlyMap<string, NotebookObject>,
  writes: PageObjectWrites,
  capturedAt = Date.now(),
): PageRecoveryPatch {
  const objects: Record<string, NotebookObject | null> = {};
  for (const row of writes.puts) objects[row.objectId] = previous.get(row.objectId) ?? null;
  for (const [, objectId] of writes.deletes) objects[objectId] = previous.get(objectId) ?? null;
  return { pageId: previousMetadata.id, capturedAt, metadata: previousMetadata, objects };
}

/**
 * Swaps a page with its recoverable prior state. The state being left becomes
 * the new recovery record, so the restore can itself be undone. `current` needs
 * to hold only the objects the patch names.
 */
export function applyRecoveryPatch(
  currentMetadata: PageMetadataRecord,
  current: ReadonlyMap<string, NotebookObject>,
  patch: PageRecoveryPatch,
  now = Date.now(),
): { metadata: PageMetadataRecord; writes: PageObjectWrites; recovery: PageRecoveryPatch } {
  if (currentMetadata.id !== patch.pageId || patch.metadata.id !== currentMetadata.id) {
    throw new Error("Recovery record belongs to another page");
  }

  const pageId = currentMetadata.id;
  const puts: PageObjectRecord[] = [];
  const deletes: PageObjectKey[] = [];
  const restoredObjects: Record<string, NotebookObject | null> = {};
  for (const [objectId, object] of Object.entries(patch.objects)) {
    restoredObjects[objectId] = current.get(objectId) ?? null;
    if (object === null) deletes.push([pageId, objectId]);
    else puts.push({ pageId, objectId, kind: object.kind, object });
  }

  return {
    metadata: {
      ...patch.metadata,
      updatedAt: Math.max(now, currentMetadata.updatedAt + 1, patch.metadata.updatedAt + 1),
    },
    writes: { puts, deletes },
    recovery: { pageId, capturedAt: now, metadata: currentMetadata, objects: restoredObjects },
  };
}

/** Every object a recovery record holds, for reference counting. */
export function recoveredObjects(patch: PageRecoveryPatch): NotebookObject[] {
  return Object.values(patch.objects).filter((object): object is NotebookObject => object !== null);
}
