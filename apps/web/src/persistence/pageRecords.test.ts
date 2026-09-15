import { describe, expect, it } from "vitest";
import { createNotebookPage } from "../domain/pages";
import { assertExpectedPageVersion, createRecoverySnapshot, PageWriteConflictError, migratePersistedPage, swapPageWithRecovery } from "./pageRecords";

describe("persisted page records", () => {
  it("migrates the pre-versioned page shape and supplies object revisions", () => {
    const migrated = migratePersistedPage({
      id: "page-legacy",
      title: "  Legacy   notes ",
      width: 900,
      height: 600,
      objects: [{ id: "node-1", kind: "graph-node", x: 1, y: 2, width: 3, height: 4, label: "Node" }],
      createdAt: 10,
      updatedAt: 20,
    });

    expect(migrated).toMatchObject({ schemaVersion: 2, title: "Legacy notes", createdAt: 10, updatedAt: 20, aiTransactions: [] });
    expect(migrated.objects[0].revision).toBe(1);
  });

  it("rejects records from a newer document schema", () => {
    expect(() => migratePersistedPage({ schemaVersion: 3, id: "future", objects: [] })).toThrow(/newer/);
  });

  it("swaps recovery and current pages so a restore can be undone", () => {
    const older = { ...createNotebookPage("Earlier", 10), id: "page-1" };
    const current = { ...older, title: "Current", updatedAt: 20 };
    const swapped = swapPageWithRecovery(current, createRecoverySnapshot(older, 15), 30);

    expect(swapped.restored).toMatchObject({ id: "page-1", title: "Earlier", updatedAt: 30 });
    expect(swapped.recovery.page).toMatchObject({ id: "page-1", title: "Current", updatedAt: 20 });
  });

  it("refuses to apply a snapshot to a different page", () => {
    const page = { ...createNotebookPage("One", 10), id: "page-1" };
    const other = { ...createNotebookPage("Two", 10), id: "page-2" };
    expect(() => swapPageWithRecovery(page, createRecoverySnapshot(other), 30)).toThrow(/another page/);
  });

  it("rejects stale writes while accepting the exact stored revision", () => {
    const current = { ...createNotebookPage("Current", 20), id: "page-1" };
    expect(() => assertExpectedPageVersion(current, 20, current.id)).not.toThrow();
    expect(() => assertExpectedPageVersion(current, 19, current.id)).toThrow(PageWriteConflictError);
    expect(() => assertExpectedPageVersion(current, undefined, current.id)).toThrow(PageWriteConflictError);
    expect(() => assertExpectedPageVersion(undefined, undefined, "new-page")).not.toThrow();
  });
});
