import { useEffect, useMemo, useRef, useState } from "react";
import type { AiTransactionRecord, NotebookObject } from "../domain/notebook";
import { contentHashOf, findStaleGeneratedObjects, selectedSourceIds } from "../domain/staleness";

const hashKey = (object: NotebookObject) => `${object.id}:${object.revision}`;

/**
 * Generated objects whose selected sources were edited or deleted after
 * generation. Hashing is asynchronous, so a source's newest revision counts
 * as unchanged until its hash is ready; only sources some transaction selected
 * are ever hashed.
 */
export function useStaleGeneratedObjects(objects: readonly NotebookObject[], transactions: readonly AiTransactionRecord[]) {
  const [hashes, setHashes] = useState<ReadonlyMap<string, string>>(new Map());
  const hashesRef = useRef(hashes);
  hashesRef.current = hashes;
  const watched = useMemo(() => selectedSourceIds(transactions), [transactions]);

  useEffect(() => {
    const targets = objects.filter((object) => watched.has(object.id) && !hashesRef.current.has(hashKey(object)));
    if (targets.length === 0) return;
    let live = true;
    void Promise.all(targets.map(async (object) => [hashKey(object), await contentHashOf(object)] as const)).then((entries) => {
      if (live) setHashes((current) => new Map([...current, ...entries]));
    });
    return () => {
      live = false;
    };
  }, [objects, watched]);

  return useMemo(
    () => findStaleGeneratedObjects(objects, transactions, (object) => hashes.get(hashKey(object))),
    [objects, transactions, hashes],
  );
}
