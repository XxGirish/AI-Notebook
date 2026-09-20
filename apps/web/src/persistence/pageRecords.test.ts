import { describe, expect, it } from "vitest";
import { createNotebookPage } from "../domain/pages";
import { assertExpectedPageVersion, PageWriteConflictError, migratePersistedPage } from "./pageRecords";

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

    expect(migrated).toMatchObject({ schemaVersion: 4, title: "Legacy notes", createdAt: 10, updatedAt: 20, aiTransactions: [] });
    expect(migrated.objects[0].revision).toBe(1);
  });

  it("migrates diagram objects through their adapter and rejects unknown fields", () => {
    const base = { schemaVersion: 2, id: "page-diagram", aiTransactions: [], createdAt: 1, updatedAt: 2 };
    const migrated = migratePersistedPage({ ...base, objects: [
      { id: "a", revision: 1, kind: "graph-node", x: 0, y: 0, width: 10, height: 10, label: "A" },
      { id: "edge", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "a", toId: "a", label: "" },
    ] });
    expect(migrated.objects[1]).not.toHaveProperty("label");
    expect(() => migratePersistedPage({ ...base, objects: [
      { id: "a", revision: 1, kind: "graph-node", x: 0, y: 0, width: 10, height: 10, label: "A", html: "<b>" },
    ] })).toThrow("migration failed");
  });

  it("rejects converted handwriting in records written before schema 3", () => {
    const word = { id: "word", revision: 1, kind: "ink-text", x: 0, y: 0, width: 10, height: 10, text: "hi" };
    expect(() => migratePersistedPage({ schemaVersion: 2, id: "old", objects: [word], aiTransactions: [] })).toThrow(/does not support/);
    expect(migratePersistedPage({ schemaVersion: 3, id: "new", objects: [word], aiTransactions: [] }).objects[0]).toMatchObject({ kind: "ink-text" });
  });

  it("rejects canvas text in records written before schema 4", () => {
    const text = { id: "text", revision: 1, kind: "text", x: 0, y: 0, width: 120, height: 40, text: "hi", fontSize: 20, color: "#183153" };
    expect(() => migratePersistedPage({ schemaVersion: 3, id: "old", objects: [text], aiTransactions: [] })).toThrow(/does not support/);
    expect(migratePersistedPage({ schemaVersion: 4, id: "new", objects: [text], aiTransactions: [] }).objects[0]).toMatchObject({ kind: "text", text: "hi" });
  });

  it("rejects records from a newer document schema", () => {
    expect(() => migratePersistedPage({ schemaVersion: 5, id: "future", objects: [] })).toThrow(/newer/);
  });

  it("rejects a record that repeats an object id", () => {
    const stroke = (id: string) => ({ id, revision: 1, kind: "stroke", tool: "pen", color: "#000", size: 3, x: 0, y: 0, width: 1, height: 1, points: [] });
    expect(() => migratePersistedPage({ schemaVersion: 4, id: "page-1", aiTransactions: [], objects: [stroke("a"), stroke("a")] }))
      .toThrow(/repeats object id a/);
  });

  it("migrates learning cards through their adapter without truncating legacy content", () => {
    const longBody = "x".repeat(9_000);
    const migrated = migratePersistedPage({
      id: "page-legacy-card",
      objects: [{ id: "note", kind: "text-card", x: 1, y: 2, width: 320, height: 140, title: "Legacy", body: longBody }],
    });

    expect(migrated.objects[0]).toMatchObject({ kind: "text-card", revision: 1, body: longBody });
  });

  it("rejects stale writes while accepting the exact stored revision", () => {
    const current = { ...createNotebookPage("Current", 20), id: "page-1" };
    expect(() => assertExpectedPageVersion(current, 20, current.id)).not.toThrow();
    expect(() => assertExpectedPageVersion(current, 19, current.id)).toThrow(PageWriteConflictError);
    expect(() => assertExpectedPageVersion(current, undefined, current.id)).toThrow(PageWriteConflictError);
    expect(() => assertExpectedPageVersion(undefined, undefined, "new-page")).not.toThrow();
  });
});
