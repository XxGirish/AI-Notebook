import { describe, expect, it } from "vitest";
import { MAX_GENERATE_REQUEST_BYTES } from "@ai-notebook/ai-contract";
import type { NotebookObject } from "../domain/notebook";
import { AiRequestError, buildGenerateRequest } from "./requestContext";

const rect = { x: 0, y: 0, width: 100, height: 60 };

const textCard = (id: string, overrides: Partial<NotebookObject> = {}): NotebookObject => ({
  id,
  revision: 1,
  kind: "text-card",
  ...rect,
  title: `Title ${id}`,
  body: `Body ${id}`,
  ...overrides,
} as NotebookObject);

const quizCard: NotebookObject = {
  id: "quiz",
  revision: 3,
  kind: "quiz-card",
  ...rect,
  prompt: "Which one?",
  options: [
    { id: "option-a", label: "A" },
    { id: "option-b", label: "B" },
  ],
  correctOptionId: "option-b",
  rationale: "Because B.",
};

const diagram: NotebookObject[] = [
  { id: "node-1", revision: 2, kind: "graph-node", x: 400, y: 0, width: 80, height: 40, label: "Start" },
  { id: "node-2", revision: 2, kind: "graph-node", x: 400, y: 120, width: 80, height: 40, label: "End" },
  { id: "edge-1", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "node-1", toId: "node-2", label: "then" },
];

const build = (objects: NotebookObject[], selected: string[], intent: Parameters<typeof buildGenerateRequest>[0]["intent"] = "teach_section") =>
  buildGenerateRequest({
    requestId: "request-abcdefgh",
    pageId: "page-1",
    intent,
    objects,
    selectedIds: new Set(selected),
    anchor: { x: 0, y: 0 },
  });

describe("AI request context", () => {
  it("sends a quiz without its answer key or rationale", () => {
    const { request } = build([quizCard], ["quiz"]);
    const serialized = JSON.stringify(request);
    expect(serialized).toContain("Which one?");
    expect(serialized).not.toContain("option-b\",\"correct");
    expect(serialized).not.toContain("Because B.");
    expect(request.context[0]).toEqual({
      kind: "quiz",
      id: "quiz",
      revision: 3,
      prompt: "Which one?",
      options: [
        { id: "option-a", label: "A" },
        { id: "option-b", label: "B" },
      ],
    });
  });

  it("puts selected work first and keeps nearer neighbours ahead of far ones", () => {
    const near = textCard("near", { x: 20, y: 20 });
    const far = textCard("far", { x: 4_000, y: 4_000 });
    const selected = textCard("selected", { x: 9_000, y: 9_000 });
    const { request, sources } = build([near, far, selected], ["selected"]);
    expect(request.context.map((item) => item.id)).toEqual(["selected", "near", "far"]);
    // Only what the writer chose is marked, so edits to neighbours never make a result stale.
    expect(sources.filter((source) => source.selected).map((source) => source.id)).toEqual(["selected"]);
  });

  it("collects graph nodes and their connectors into one diagram item", () => {
    const { request, sources } = build([...diagram], ["node-1"], "create_quiz");
    expect(request.context).toHaveLength(1);
    const item = request.context[0];
    expect(item.kind).toBe("diagram");
    if (item.kind !== "diagram") throw new Error("expected a diagram");
    expect(item.nodes.map((node) => node.label)).toEqual(["Start", "End"]);
    expect(item.edges).toEqual([{ fromId: "node-1", toId: "node-2", label: "then" }]);
    // Provenance covers every node whose text was sent.
    // Selecting one node selects its diagram, so every node it sent is part of what was chosen.
    expect(sources).toEqual([
      { id: "node-1", revision: 2, selected: true },
      { id: "node-2", revision: 2, selected: true },
    ]);
  });

  it("refuses an action that reads the writer's work when nothing is selected", () => {
    expect(() => build([textCard("a")], [], "explain_selection")).toThrow(AiRequestError);
    expect(() => build([textCard("a")], [], "explain_selection")).toThrow(/Select a note/);
  });

  it("lets a whole-page action run with nothing selected", () => {
    const { request } = build([textCard("a")], []);
    expect(request.intent).toBe("teach_section");
    expect(request.permittedOperations).toEqual(["insert_lesson_section"]);
  });

  it("never permits object updates, and sends no update targets", () => {
    for (const intent of ["teach_section", "explain_selection", "create_diagram", "create_quiz"] as const) {
      const { request } = build([textCard("a")], ["a"], intent);
      expect(request.permittedOperations).not.toContain("propose_object_update");
      expect(request.targets).toEqual([]);
    }
  });

  it("drops the least relevant context until the request fits the gateway limit", () => {
    const big = Array.from({ length: 40 }, (_, index) => textCard(`card-${index}`, { body: "x".repeat(7_000), x: index * 10, y: index * 10 }));
    const { request, sources } = build(big, ["card-0"]);
    const bytes = new TextEncoder().encode(JSON.stringify(request)).length;
    expect(bytes).toBeLessThanOrEqual(MAX_GENERATE_REQUEST_BYTES);
    expect(request.context.length).toBeGreaterThan(0);
    expect(request.context[0].id).toBe("card-0");
    // Only what was actually sent is recorded as a source.
    expect(sources).toHaveLength(request.context.length);
  });

  it("trims an over-long note rather than refusing it", () => {
    const { request } = build([textCard("long", { body: "y".repeat(20_000) })], ["long"]);
    const item = request.context[0];
    if (item.kind !== "text") throw new Error("expected text");
    expect(item.body).toHaveLength(8_000);
    expect(item.body.endsWith("…")).toBe(true);
  });

  it("sends typed notes and converted handwriting as text", () => {
    const typed: NotebookObject = { id: "typed", revision: 1, kind: "text", ...rect, text: "Typed note", fontSize: 18, color: "#000" };
    const converted: NotebookObject = {
      id: "converted",
      revision: 1,
      kind: "ink-text",
      ...rect,
      text: "From ink",
      fontSize: 18,
      color: "#000",
      recognizedText: "From ink",
      recognizer: "test",
      sourceStrokes: [],
    };
    const { request } = build([typed, converted], ["typed", "converted"]);
    expect(request.context.map((item) => (item.kind === "text" ? item.body : ""))).toEqual(["Typed note", "From ink"]);
  });

  it("leaves ink and pictures out, because they carry no text to send", () => {
    const stroke: NotebookObject = { id: "stroke", revision: 1, kind: "stroke", ...rect, tool: "pen", color: "#000", size: 2, points: [] };
    const image: NotebookObject = { id: "image", revision: 1, kind: "image", ...rect, assetHash: "hash", mimeType: "image/png", name: "p.png" };
    const { request } = build([stroke, image, textCard("card")], ["card"]);
    expect(request.context.map((item) => item.id)).toEqual(["card"]);
  });
});
