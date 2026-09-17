import { describe, expect, it } from "vitest";
import type { GeneratedContentProvenance, NotebookObject } from "../domain/notebook";
import type { CanvasProposal } from "@ai-notebook/ai-contract";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../domain/history";
import { applyCanvasBatch, CanvasBatchError, commitCanvasBatchToPage, prepareCanvasBatch } from "./proposalCompiler";

const provenance: GeneratedContentProvenance = {
  requestId: "request-1",
  intent: "teach_section",
  provider: "mock",
  model: "deterministic-fixture",
  configurationId: "mock-v1",
  proposalSchemaVersion: 1,
  sources: [{ id: "source", revision: 2 }],
};

const existing: NotebookObject[] = [{ id: "source", revision: 2, kind: "text-card", x: 20, y: 20, width: 200, height: 100, title: "Source", body: "Keep me" }];
let nextId = 0;
const compile = (proposal: CanvasProposal) => prepareCanvasBatch({
  transactionId: "transaction-1",
  pageId: "page-1",
  existingObjects: existing,
  proposal,
  provenance,
  selectionBounds: { x: 20, y: 20, width: 200, height: 100 },
  viewportCenter: { x: 640, y: 410 },
  idFactory: () => String(++nextId),
});

describe("semantic proposal compiler", () => {
  it("lays out editable diagram nodes and bound connectors using application IDs", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{
      type: "insert_diagram",
      localId: "flow",
      anchor: { relation: "right_of_selection" },
      content: {
        kind: "diagram",
        title: "Flow",
        direction: "left_to_right",
        nodes: [{ localId: "a", label: "Start" }, { localId: "b", label: "Finish" }],
        edges: [{ from: "a", to: "b", label: "then" }],
      },
    }] });
    const nodes = batch.inserts.filter((object) => object.kind === "graph-node");
    const edge = batch.inserts.find((object) => object.kind === "connector");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].x).toBeGreaterThanOrEqual(268);
    expect(nodes[1].x).toBeGreaterThan(nodes[0].x);
    expect(edge).toMatchObject({ fromId: nodes[0].id, toId: nodes[1].id, label: "then" });
    expect(batch.inserts[0]).toMatchObject({ kind: "text-card", title: "Flow" });
    expect(new Set(batch.inserts.map((object) => object.groupId)).size).toBe(1);
  });

  it("creates stable local quiz correctness with newly allocated option IDs", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{
      type: "insert_quiz",
      localId: "check",
      anchor: { relation: "below_selection" },
      content: { kind: "quiz", prompt: "Pick B", options: [{ localId: "a", label: "A" }, { localId: "b", label: "B" }], correctOptionLocalId: "b", rationale: "B is correct.", conceptTags: ["letters"] },
    }] });
    const quiz = batch.inserts[0];
    expect(quiz.kind).toBe("quiz-card");
    if (quiz.kind !== "quiz-card") return;
    expect(new Set(quiz.options.map((option) => option.id)).size).toBe(2);
    expect(quiz.correctOptionId).toBe(quiz.options[1].id);
    expect(quiz.y).toBeGreaterThan(120);
  });

  it("keeps equation explanations as a grouped editable text card", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{
      type: "insert_equation",
      localId: "equation",
      anchor: { relation: "viewport_center" },
      content: { kind: "equation", title: "Energy", latex: "E=mc^2", explanation: "Mass and energy are related." },
    }] });
    expect(batch.inserts.map((object) => object.kind)).toEqual(["equation-card", "text-card"]);
    expect(batch.inserts[0].groupId).toBe(batch.inserts[1].groupId);
    expect(batch.inserts[1].y).toBeGreaterThan(batch.inserts[0].y);
  });

  it("applies one batch without deleting user ink added while generation was pending", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{ type: "insert_explanation", localId: "explain", anchor: { relation: "below_selection" }, content: { kind: "text", title: "Explanation", body: "A generated explanation." } }] });
    const laterInk: NotebookObject = { id: "later-ink", revision: 1, kind: "stroke", tool: "pen", color: "#000", size: 4, x: 0, y: 0, width: 10, height: 10, points: [{ x: 1, y: 1, pressure: 0.5, time: 1 }] };
    const applied = applyCanvasBatch("page-1", [...existing, laterInk], batch, new Set());
    expect(applied.applied).toBe(true);
    expect(applied.objects).toContain(laterInk);
    expect(applied.objects).toHaveLength(existing.length + 2);
  });

  it("undoes one AI transaction as one step while keeping ink committed during generation", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{ type: "insert_explanation", localId: "explain", anchor: { relation: "below_selection" }, content: { kind: "text", title: "Explanation", body: "A generated explanation." } }] });
    const laterInk: NotebookObject = { id: "later-ink", revision: 1, kind: "stroke", tool: "pen", color: "#000", size: 4, x: 0, y: 0, width: 10, height: 10, points: [{ x: 1, y: 1, pressure: 0.5, time: 1 }] };
    const withInk = commitHistory(createHistory(existing), [...existing, laterInk]);
    const withLesson = commitHistory(withInk, applyCanvasBatch("page-1", withInk.present, batch, new Set()).objects);

    const undone = undoHistory(withLesson);
    expect(undone.present).toEqual([...existing, laterInk]);
    expect(redoHistory(undone).present.map((object) => object.id)).toEqual(withLesson.present.map((object) => object.id));
  });

  it("is idempotent and rejects a stale update without partial insertion", () => {
    nextId = 0;
    const updateProposal: CanvasProposal = { schemaVersion: 1, operations: [
      { type: "insert_explanation", localId: "new", anchor: { relation: "below_selection" }, content: { kind: "text", title: "New", body: "New content" } },
      { type: "propose_object_update", targetId: "source", expectedRevision: 2, content: { kind: "text", title: "Updated", body: "Updated safely" } },
    ] };
    const batch = compile(updateProposal);
    expect(applyCanvasBatch("page-1", existing, batch, new Set([batch.transactionId]))).toEqual({ objects: existing, applied: false });
    const changed = [{ ...existing[0], revision: 3 } as NotebookObject];
    expect(() => applyCanvasBatch("page-1", changed, batch, new Set())).toThrow(CanvasBatchError);
    expect(changed).toHaveLength(1);
  });

  it("rejects a late batch on another page or after its source changes", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{ type: "insert_explanation", localId: "explain", anchor: { relation: "below_selection" }, content: { kind: "text", title: "Why", body: "Because." } }] });
    expect(() => applyCanvasBatch("page-2", existing, batch, new Set())).toThrow(/belongs to page page-1/);
    const changedSource = [{ ...existing[0], revision: 3 } as NotebookObject];
    expect(() => applyCanvasBatch("page-1", changedSource, batch, new Set())).toThrow(/source source changed/);
  });

  it("records provenance on the atomic batch without placing provider data in canvas geometry", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{ type: "insert_explanation", localId: "explain", anchor: { relation: "below_selection" }, content: { kind: "text", title: "Why", body: "Because." } }] });
    expect(batch.provenance).toEqual(provenance);
    expect(batch.proposal.schemaVersion).toBe(1);
    expect(batch.generatedObjectIds).toEqual(batch.inserts.map((object) => object.id));
    expect(batch.inserts[0]).not.toHaveProperty("provider");
  });

  it("commits objects and durable transaction metadata to a page together", () => {
    nextId = 0;
    const batch = compile({ schemaVersion: 1, operations: [{ type: "insert_explanation", localId: "explain", anchor: { relation: "below_selection" }, content: { kind: "text", title: "Why", body: "Because." } }] });
    const page = { schemaVersion: 3 as const, id: "page-1", title: "Page", width: 1280, height: 820, objects: existing, aiTransactions: [], createdAt: 1, updatedAt: 2 };
    const committed = commitCanvasBatchToPage(page, batch, 10);
    expect(committed.objects).toHaveLength(2);
    expect(committed.aiTransactions[0]).toMatchObject({ transactionId: "transaction-1", requestId: "request-1", committedAt: 10, generatedObjectIds: batch.generatedObjectIds });
    expect(commitCanvasBatchToPage(committed, batch, 11)).toBe(committed);
  });
});
