import type { NotebookPage } from "../domain/pages";
import type { PageRecoverySnapshot } from "./pageRecords";

export function referencedAssetHashes(pages: Iterable<NotebookPage>, recoveries: Iterable<PageRecoverySnapshot>): Set<string> {
  const referenced = new Set<string>();
  const collect = (page: NotebookPage) => {
    for (const object of page.objects) {
      if (object.kind === "image") referenced.add(object.assetHash);
    }
  };
  for (const page of pages) collect(page);
  for (const recovery of recoveries) collect(recovery.page);
  return referenced;
}

export function orphanAssetHashes(
  pages: Iterable<NotebookPage>,
  recoveries: Iterable<PageRecoverySnapshot>,
  storedHashes: Iterable<string>,
): string[] {
  const referenced = referencedAssetHashes(pages, recoveries);
  return [...storedHashes].filter((hash) => !referenced.has(hash));
}
