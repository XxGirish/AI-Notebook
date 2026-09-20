import type { NotebookObject } from "../domain/notebook";

/**
 * Asset reference counting works from loose objects rather than whole pages:
 * stored objects are rows the database can query by kind, and recovery records
 * hold only the objects their save changed (see pageDelta.ts).
 */
export function referencedAssetHashes(objectGroups: Iterable<Iterable<NotebookObject>>): Set<string> {
  const referenced = new Set<string>();
  for (const objects of objectGroups) {
    for (const object of objects) {
      if (object.kind === "image") referenced.add(object.assetHash);
    }
  }
  return referenced;
}

export function orphanAssetHashes(
  objectGroups: Iterable<Iterable<NotebookObject>>,
  storedHashes: Iterable<string>,
): string[] {
  const referenced = referencedAssetHashes(objectGroups);
  return [...storedHashes].filter((hash) => !referenced.has(hash));
}
