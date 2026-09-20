import { describe, expect, it } from "vitest";
import type { NotebookObject, StrokeObject } from "../domain/notebook";
import { createNotebookPage, replacePageObjects, type NotebookPage } from "../domain/pages";
import {
  applyRecoveryPatch,
  assemblePage,
  diffPageObjects,
  DuplicateObjectIdError,
  objectMapOf,
  recoveredObjects,
  recoveryPatchFor,
  splitPage,
} from "./pageDelta";

const stroke = (id: string, x = 0): StrokeObject => ({
  id,
  revision: 1,
  kind: "stroke",
  tool: "pen",
  color: "#183153",
  size: 4,
  x,
  y: 0,
  width: 10,
  height: 10,
  points: [{ x, y: 0, pressure: 0.5, time: 1 }],
});

const pageWith = (objects: NotebookObject[]): NotebookPage => (
  replacePageObjects({ ...createNotebookPage("Notes", 10), id: "page-1" }, objects, 20)
);

describe("page object rows", () => {
  it("splits a page into metadata plus rows and puts it back in document order", () => {
    const objects = [stroke("a"), stroke("b", 20), stroke("c", 40)];
    const { metadata, objects: rows } = splitPage(pageWith(objects));

    expect(metadata).not.toHaveProperty("objects");
    expect(metadata.objectIds).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.kind)).toEqual(["stroke", "stroke", "stroke"]);

    // Rows come back from IndexedDB in key order, not document order.
    const shuffled = [rows[2], rows[0], rows[1]];
    expect(assemblePage(metadata, shuffled).objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
  });

  it("refuses a page that repeats an object id instead of dropping one row", () => {
    expect(() => splitPage(pageWith([stroke("a"), stroke("a", 30)]))).toThrow(DuplicateObjectIdError);
    expect(() => diffPageObjects("page-1", new Map(), [stroke("a"), stroke("a", 30)])).toThrow(DuplicateObjectIdError);
  });

  it("reports a missing object row rather than silently losing ink", () => {
    const { metadata, objects: rows } = splitPage(pageWith([stroke("a"), stroke("b", 20)]));
    expect(() => assemblePage(metadata, [rows[0]])).toThrow(/missing object b/);
  });

  it("ignores rows the metadata no longer lists", () => {
    const { objects: rows } = splitPage(pageWith([stroke("a"), stroke("orphan", 20)]));
    const { metadata } = splitPage(pageWith([stroke("a")]));
    expect(assemblePage(metadata, rows).objects.map((object) => object.id)).toEqual(["a"]);
  });
});

describe("what one save changed", () => {
  it("writes only the objects whose identity changed", () => {
    const kept = stroke("kept");
    const edited = stroke("edited");
    const previous = objectMapOf([kept, edited, stroke("removed", 40)]);
    const added = stroke("added", 60);
    const rewritten = { ...edited, x: 99 };

    const writes = diffPageObjects("page-1", previous, [kept, rewritten, added]);

    expect(writes.puts.map((row) => row.objectId)).toEqual(["edited", "added"]);
    expect(writes.deletes).toEqual([["page-1", "removed"]]);
  });

  it("writes nothing when only the object order changed, because the order lives in the metadata", () => {
    const [first, second] = [stroke("first"), stroke("second", 20)];
    const writes = diffPageObjects("page-1", objectMapOf([first, second]), [second, first]);

    expect(writes.puts).toEqual([]);
    expect(writes.deletes).toEqual([]);
    expect(splitPage(pageWith([second, first])).metadata.objectIds).toEqual(["second", "first"]);
  });

  it("treats a deep-equal replacement as a change, matching how the document model tracks edits", () => {
    const original = stroke("a");
    const writes = diffPageObjects("page-1", objectMapOf([original]), [{ ...original }]);
    expect(writes.puts).toHaveLength(1);
  });
});

describe("the one recoverable prior state", () => {
  const previousObjects = [stroke("kept"), stroke("edited", 20), stroke("removed", 40)];
  const previousPage = pageWith(previousObjects);
  const nextObjects = [previousObjects[0], { ...previousObjects[1], x: 99 }, stroke("added", 60)];
  const nextPage = replacePageObjects(previousPage, nextObjects, 30);

  const patchForThatSave = () => {
    const previousMetadata = splitPage(previousPage).metadata;
    const previous = objectMapOf(previousObjects);
    const writes = diffPageObjects("page-1", previous, nextObjects);
    return { previousMetadata, patch: recoveryPatchFor(previousMetadata, previous, writes, 25) };
  };

  it("records only the objects the save touched", () => {
    const { patch } = patchForThatSave();
    expect(Object.keys(patch.objects).sort()).toEqual(["added", "edited", "removed"]);
    expect(patch.objects.added).toBeNull();
    expect(patch.objects.edited).toMatchObject({ x: 20 });
    expect(patch.objects.removed).toMatchObject({ x: 40 });
    expect(recoveredObjects(patch).map((object) => object.id).sort()).toEqual(["edited", "removed"]);
  });

  it("restores the prior page and leaves the state it replaced as the next recovery", () => {
    const { patch } = patchForThatSave();
    const currentMetadata = splitPage(nextPage).metadata;
    const touched = objectMapOf(nextObjects.filter((object) => object.id in patch.objects));

    const swap = applyRecoveryPatch(currentMetadata, touched, patch, 40);

    expect(swap.metadata.objectIds).toEqual(["kept", "edited", "removed"]);
    expect(swap.metadata.updatedAt).toBe(40);
    expect(swap.writes.puts.map((row) => row.objectId).sort()).toEqual(["edited", "removed"]);
    expect(swap.writes.deletes).toEqual([["page-1", "added"]]);

    const restored = assemblePage(swap.metadata, [
      { pageId: "page-1", objectId: "kept", kind: "stroke" as const, object: previousObjects[0] },
      ...swap.writes.puts,
    ]);
    expect(restored.objects.map((object) => [object.id, object.x])).toEqual([["kept", 0], ["edited", 20], ["removed", 40]]);

    // Undoing the restore has to put the page back exactly where it was.
    const reverted = applyRecoveryPatch(swap.metadata, objectMapOf(restored.objects), swap.recovery, 50);
    expect(reverted.metadata.objectIds).toEqual(["kept", "edited", "added"]);
    expect(reverted.writes.puts.map((row) => row.objectId).sort()).toEqual(["added", "edited"]);
    expect(reverted.writes.deletes).toEqual([["page-1", "removed"]]);
  });

  it("keeps the restored page ahead of both states it came from", () => {
    const { patch } = patchForThatSave();
    const currentMetadata = { ...splitPage(nextPage).metadata, updatedAt: 90 };
    expect(applyRecoveryPatch(currentMetadata, new Map(), patch, 40).metadata.updatedAt).toBe(91);
  });

  it("refuses a record belonging to another page", () => {
    const { patch } = patchForThatSave();
    const other = { ...splitPage(nextPage).metadata, id: "page-2" };
    expect(() => applyRecoveryPatch(other, new Map(), patch, 40)).toThrow(/another page/);
  });
});
