import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImageObject, NotebookObject, StrokeObject } from "../domain/notebook";
import { createNotebookPage, replacePageObjects, type NotebookPage } from "../domain/pages";
import {
  cleanupOrphanAssets,
  deletePage,
  hasRecoverySnapshot,
  loadPages,
  restorePreviousPage,
  savePage,
  storeImportedNotebook,
  loadLibrary,
  addQuizAttempt,
  loadQuizAttempts,
} from "./notebookDatabase";
import { PageWriteConflictError } from "./pageRecords";

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

const image = (id: string, assetHash: string): ImageObject => ({
  id,
  revision: 1,
  kind: "image",
  assetHash,
  mimeType: "image/png",
  name: `${id}.png`,
  x: 0,
  y: 0,
  width: 40,
  height: 40,
});

let clock = 1_000;
const newPage = (title: string, objects: NotebookObject[] = []) => (
  replacePageObjects(createNotebookPage(title, (clock += 10)), objects, (clock += 10))
);
const editPage = (page: NotebookPage, objects: NotebookObject[]) => replacePageObjects(page, objects, (clock += 10));

/** A second connection, used to watch what a save actually wrote. */
function inspector() {
  const database = new Dexie("ai-notebook");
  database.version(4).stores({
    pages: "id, createdAt, updatedAt",
    pageObjects: "[pageId+objectId], pageId, kind",
    recoverySnapshots: "pageId, capturedAt",
    assets: "hash, createdAt",
  });
  return database;
}

beforeEach(async () => {
  const database = inspector();
  await database.open();
  await Promise.all([
    database.table("pages").clear(),
    database.table("pageObjects").clear(),
    database.table("recoverySnapshots").clear(),
    database.table("assets").clear(),
  ]);
  database.close();
});

describe("saving a page", () => {
  it("round-trips objects in document order", async () => {
    const page = newPage("Notes", [stroke("a"), stroke("b", 20), stroke("c", 40)]);
    await savePage(page);

    const [loaded] = await loadPages();
    expect(loaded.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
    expect(loaded.title).toBe("Notes");
  });

  it("leaves rows for unchanged objects alone", async () => {
    const kept = stroke("kept");
    const page = newPage("Notes", [kept, stroke("edited", 20)]);
    await savePage(page);

    // A marker no code path would write. A whole-page save would overwrite it.
    const database = inspector();
    await database.open();
    const row = await database.table("pageObjects").get([page.id, "kept"]);
    await database.table("pageObjects").put({ ...row, object: { ...row.object, color: "#marker" } });
    database.close();

    const next = editPage(page, [kept, stroke("edited", 99), stroke("added", 40)]);
    await savePage(next, page.updatedAt);

    const [loaded] = await loadPages();
    expect(loaded.objects.map((object) => object.id)).toEqual(["kept", "edited", "added"]);
    expect((loaded.objects[0] as StrokeObject).color).toBe("#marker");
    expect((loaded.objects[1] as StrokeObject).x).toBe(99);
  });

  it("keeps the order when nothing else changed", async () => {
    const [first, second] = [stroke("first"), stroke("second", 20)];
    const page = newPage("Notes", [first, second]);
    await savePage(page);
    await savePage(editPage(page, [second, first]), page.updatedAt);

    const [loaded] = await loadPages();
    expect(loaded.objects.map((object) => object.id)).toEqual(["second", "first"]);
  });

  it("applies queued saves in order", async () => {
    const page = newPage("Notes", [stroke("a")]);
    await savePage(page);
    const second = editPage(page, [stroke("a"), stroke("b", 20)]);
    const third = editPage(second, [stroke("a"), stroke("b", 20), stroke("c", 40)]);
    await Promise.all([savePage(second, page.updatedAt), savePage(third, second.updatedAt)]);

    const [loaded] = await loadPages();
    expect(loaded.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects a stale write and still saves correctly afterwards", async () => {
    const page = newPage("Notes", [stroke("a")]);
    await savePage(page);
    await savePage(editPage(page, [stroke("a"), stroke("b", 20)]), page.updatedAt);

    await expect(savePage(editPage(page, [stroke("z")]), page.updatedAt)).rejects.toThrow(PageWriteConflictError);

    // The failed save dropped this tab's mirror; the next one reads the stored
    // objects instead of trusting it.
    const [current] = await loadPages();
    await savePage(editPage(current, [...current.objects, stroke("c", 40)]), current.updatedAt);
    const [loaded] = await loadPages();
    expect(loaded.objects.map((object) => object.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the one recoverable prior state", () => {
  it("restores the previous page and can undo the restore", async () => {
    const page = newPage("Notes", [stroke("a"), stroke("b", 20)]);
    await savePage(page);
    expect(await hasRecoverySnapshot(page.id)).toBe(false);

    const edited = editPage(page, [stroke("a"), stroke("c", 40)]);
    const { hasRecovery } = await savePage(edited, page.updatedAt);
    expect(hasRecovery).toBe(true);

    const restored = await restorePreviousPage(page.id, edited.updatedAt);
    expect(restored?.objects.map((object) => object.id)).toEqual(["a", "b"]);
    expect((await loadPages())[0].objects.map((object) => object.id)).toEqual(["a", "b"]);

    const redone = await restorePreviousPage(page.id, restored!.updatedAt);
    expect(redone?.objects.map((object) => object.id)).toEqual(["a", "c"]);
  });

  it("returns nothing when the page has no prior state", async () => {
    const page = newPage("Notes", [stroke("a")]);
    await savePage(page);
    expect(await restorePreviousPage(page.id, page.updatedAt)).toBeUndefined();
  });
});

describe("deleting a page", () => {
  it("removes its object rows and its recoverable state", async () => {
    const page = newPage("Notes", [stroke("a"), stroke("b", 20)]);
    await savePage(page);
    const edited = editPage(page, [stroke("a")]);
    await savePage(edited, page.updatedAt);

    const replacement = newPage("Blank");
    await deletePage(page.id, edited.updatedAt, replacement);

    const database = inspector();
    await database.open();
    expect(await database.table("pageObjects").where("pageId").equals(page.id).count()).toBe(0);
    expect(await database.table("recoverySnapshots").get(page.id)).toBeUndefined();
    database.close();

    const loaded = await loadPages();
    expect(loaded.map((entry) => entry.title)).toEqual(["Blank"]);
  });
});

describe("importing an archive", () => {
  it("stores every page with its objects", async () => {
    const first = newPage("One", [stroke("a")]);
    const second = newPage("Two", [stroke("b"), stroke("c", 20)]);
    await storeImportedNotebook([first, second], []);

    const loaded = await loadPages();
    expect(loaded.map((page) => page.title)).toEqual(["One", "Two"]);
    expect(loaded[1].objects.map((object) => object.id)).toEqual(["b", "c"]);
  });

  const librarySource = (id: string, hash: string) => ({
    source: { id, name: `${id}.txt`, kind: "text" as const, size: 4, contentHash: hash, chunkCount: 2, characterCount: 8, enabled: true, addedAt: 1 },
    chunks: [
      { id: `${id}:1`, sourceId: id, ordinal: 1, text: "last" },
      { id: `${id}:0`, sourceId: id, ordinal: 0, text: "firs" },
    ],
  });

  it("stores imported sources and chat with the pages, and reads them back as one library", async () => {
    await storeImportedNotebook([newPage("Library", [])], [], {
      sources: [librarySource("imported-source", "1".repeat(64))],
      chatMessages: [{ id: "imported-message", role: "user", content: "hello", createdAt: 3 }],
    });
    const library = await loadLibrary();
    const imported = library.sources.find((entry) => entry.source.id === "imported-source");
    expect(imported?.chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1]);
    expect(library.chatMessages.map((message) => message.id)).toContain("imported-message");
  });

  it("stores nothing when any part of the import fails", async () => {
    const page = newPage("Should not appear", []);
    // A message id that already exists makes the last write of the transaction fail.
    await storeImportedNotebook([newPage("First", [])], [], { sources: [], chatMessages: [{ id: "taken", role: "user", content: "x", createdAt: 1 }] });
    await expect(storeImportedNotebook([page], [], {
      sources: [librarySource("half-imported", "2".repeat(64))],
      chatMessages: [{ id: "taken", role: "user", content: "again", createdAt: 2 }],
    })).rejects.toThrow();

    expect((await loadPages()).map((entry) => entry.id)).not.toContain(page.id);
    expect((await loadLibrary()).sources.map((entry) => entry.source.id)).not.toContain("half-imported");
  });
});

describe("asset cleanup", () => {
  const hashOf = (letter: string) => letter.repeat(64);

  const seedAsset = async (hash: string) => {
    const database = inspector();
    await database.open();
    await database.table("assets").put({ hash, blob: new Blob(["x"]), mimeType: "image/png", size: 1, createdAt: 1 });
    database.close();
  };

  it("keeps assets held by a current object or by the recoverable prior state", async () => {
    await Promise.all([seedAsset(hashOf("a")), seedAsset(hashOf("b")), seedAsset(hashOf("c"))]);
    const page = newPage("Notes", [image("kept", hashOf("a")), image("dropped", hashOf("b"))]);
    await savePage(page);
    await savePage(editPage(page, [image("kept", hashOf("a"))]), page.updatedAt);

    // "b" survives because restoring the page would bring its image back.
    expect(await cleanupOrphanAssets()).toEqual({ removedCount: 1, removedBytes: 1 });

    const database = inspector();
    await database.open();
    expect((await database.table("assets").toArray()).map((asset) => asset.hash).sort()).toEqual([hashOf("a"), hashOf("b")]);
    database.close();
  });
});

describe("quiz attempts (database version 6)", () => {
  const attempt = (id: string, pageId: string, answeredAt: number) => ({
    id, pageId, quizId: "quiz", quizRevision: 1, chosenOptionId: "a", correct: true, sequence: 1, answeredAt,
  });

  it("keeps attempts per page in the order they were given and never overwrites one", async () => {
    const page = newPage("Quiz page");
    await savePage(page);
    await addQuizAttempt(attempt("second", page.id, 20));
    await addQuizAttempt(attempt("first", page.id, 10));
    await addQuizAttempt(attempt("elsewhere", "another-page", 5));
    await expect(addQuizAttempt({ ...attempt("first", page.id, 10), correct: false })).rejects.toThrow();

    const stored = await loadQuizAttempts(page.id);
    expect(stored.map((entry) => [entry.id, entry.correct])).toEqual([["first", true], ["second", true]]);
    expect((await loadLibrary()).quizAttempts.map((entry) => entry.id)).toEqual(expect.arrayContaining(["first", "second", "elsewhere"]));
  });

  it("removes a page's attempts together with the page", async () => {
    const page = newPage("Deleted with answers");
    const kept = newPage("Kept");
    await savePage(page);
    await savePage(kept);
    await addQuizAttempt(attempt("gone", page.id, 1));
    await addQuizAttempt(attempt("stays", kept.id, 2));

    await deletePage(page.id, page.updatedAt);
    expect(await loadQuizAttempts(page.id)).toEqual([]);
    expect((await loadQuizAttempts(kept.id)).map((entry) => entry.id)).toEqual(["stays"]);
  });
});
