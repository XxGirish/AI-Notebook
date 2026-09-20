import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import type { StrokeObject } from "../domain/notebook";

/**
 * Notebooks written before objects moved into their own rows. The application
 * module is imported only after the old records exist, so opening the database
 * runs the real version-4 upgrade.
 */
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

const legacyPage = (id: string, title: string, objects: unknown[], updatedAt: number) => ({
  schemaVersion: 4,
  id,
  title,
  width: 1280,
  height: 820,
  objects,
  aiTransactions: [],
  createdAt: 10,
  updatedAt,
});

async function seedVersionThree() {
  const database = new Dexie("ai-notebook");
  database.version(3).stores({
    pages: "id, createdAt, updatedAt",
    recoverySnapshots: "pageId, capturedAt",
    assets: "hash, createdAt",
  });
  await database.open();
  await database.table("pages").bulkPut([
    legacyPage("page-1", "Kept", [stroke("a"), stroke("b", 20)], 100),
    legacyPage("page-2", "Other", [stroke("c")], 100),
  ]);
  await database.table("recoverySnapshots").put({
    pageId: "page-1",
    capturedAt: 90,
    page: legacyPage("page-1", "Kept", [stroke("a"), stroke("older", 40)], 80),
  });
  database.close();
}

describe("upgrading a notebook stored as whole pages", () => {
  it("splits pages into object rows and keeps the recoverable prior state usable", async () => {
    await seedVersionThree();
    const { loadPages, restorePreviousPage } = await import("./notebookDatabase");

    const pages = await loadPages();
    expect(pages.map((page) => page.title)).toEqual(["Kept", "Other"]);
    expect(pages[0].objects.map((object) => object.id)).toEqual(["a", "b"]);
    expect(pages[1].objects.map((object) => object.id)).toEqual(["c"]);

    const restored = await restorePreviousPage("page-1", pages[0].updatedAt);
    expect(restored?.objects.map((object) => object.id)).toEqual(["a", "older"]);

    // The state the restore replaced is still the one recoverable prior state.
    const redone = await restorePreviousPage("page-1", restored!.updatedAt);
    expect(redone?.objects.map((object) => object.id)).toEqual(["a", "b"]);
  });
});
