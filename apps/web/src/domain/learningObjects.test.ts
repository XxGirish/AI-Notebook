import { describe, expect, it } from "vitest";
import type { NotebookObject, QuizCardObject } from "./notebook";
import { applyLearningObjectEdit, getFocusedDiagramObject } from "./learningObjects";

const quiz: QuizCardObject = {
  id: "quiz-1",
  revision: 3,
  kind: "quiz-card",
  prompt: "Old prompt",
  options: [
    { id: "option-a", label: "A" },
    { id: "option-b", label: "B" },
  ],
  correctOptionId: "option-a",
  rationale: "Old rationale",
  x: 0,
  y: 0,
  width: 320,
  height: 280,
};

describe("learning object edits", () => {
  it("updates quiz content while preserving stable option identities", () => {
    const result = applyLearningObjectEdit([quiz], quiz.id, {
      kind: "quiz-card",
      prompt: "New prompt",
      options: [
        { id: "option-a", label: "First" },
        { id: "option-b", label: "Second" },
      ],
      correctOptionId: "option-b",
      rationale: "New rationale",
    });

    expect(result[0]).toMatchObject({
      revision: 4,
      prompt: "New prompt",
      correctOptionId: "option-b",
      rationale: "New rationale",
      options: [
        { id: "option-a", label: "First" },
        { id: "option-b", label: "Second" },
      ],
    });
  });

  it("rejects an invalid quiz answer key without changing the document", () => {
    const objects: NotebookObject[] = [quiz];
    expect(applyLearningObjectEdit(objects, quiz.id, {
      kind: "quiz-card",
      prompt: "Prompt",
      options: quiz.options,
      correctOptionId: "missing",
      rationale: "Rationale",
    })).toBe(objects);
  });

  it("does not apply an edit intended for a different object kind", () => {
    const objects: NotebookObject[] = [quiz];
    expect(applyLearningObjectEdit(objects, quiz.id, {
      kind: "equation-card",
      title: "Equation",
      latex: "x=1",
    })).toBe(objects);
  });

  it("rejects empty or oversized editable content at the document boundary", () => {
    const objects: NotebookObject[] = [quiz];
    expect(applyLearningObjectEdit(objects, quiz.id, {
      kind: "quiz-card",
      prompt: "",
      options: quiz.options,
      correctOptionId: quiz.correctOptionId,
      rationale: "Rationale",
    })).toBe(objects);
    expect(applyLearningObjectEdit(objects, quiz.id, {
      kind: "quiz-card",
      prompt: "Prompt",
      options: quiz.options.map((option) => ({ ...option, label: "x".repeat(241) })),
      correctOptionId: quiz.correctOptionId,
      rationale: "Rationale",
    })).toBe(objects);
  });

  it("edits diagram labels without changing connector bindings", () => {
    const objects: NotebookObject[] = [
      { id: "from", revision: 1, kind: "graph-node", label: "Force", x: 0, y: 0, width: 100, height: 60 },
      { id: "to", revision: 1, kind: "graph-node", label: "Motion", x: 200, y: 0, width: 100, height: 60 },
      { id: "edge", revision: 2, kind: "connector", label: "causes", fromId: "from", toId: "to", x: 0, y: 0, width: 0, height: 0 },
    ];

    const renamedNode = applyLearningObjectEdit(objects, "from", { kind: "graph-node", label: "Net force" });
    const renamedEdge = applyLearningObjectEdit(renamedNode, "edge", { kind: "connector", label: "changes" });

    expect(renamedEdge[0]).toMatchObject({ label: "Net force", revision: 2 });
    expect(renamedEdge[2]).toMatchObject({ label: "changes", revision: 3, fromId: "from", toId: "to" });
  });

  it("allows a connector label to be removed but rejects an empty node label", () => {
    const edge: NotebookObject = { id: "edge", revision: 1, kind: "connector", label: "old", fromId: "from", toId: "to", x: 0, y: 0, width: 0, height: 0 };
    expect(applyLearningObjectEdit([edge], "edge", { kind: "connector" })[0]).not.toHaveProperty("label");

    const node: NotebookObject = { id: "node", revision: 1, kind: "graph-node", label: "Old", x: 0, y: 0, width: 100, height: 60 };
    expect(applyLearningObjectEdit([node], "node", { kind: "graph-node", label: "" })).toEqual([node]);
  });

  it("keeps the directly focused diagram member editable when its whole group is selected", () => {
    const objects: NotebookObject[] = [
      { id: "title", revision: 1, groupId: "diagram", kind: "text-card", title: "Diagram", body: "", x: 0, y: 0, width: 200, height: 60 },
      { id: "node", revision: 1, groupId: "diagram", kind: "graph-node", label: "Force", x: 0, y: 100, width: 100, height: 60 },
      { id: "edge", revision: 1, groupId: "diagram", kind: "connector", fromId: "node", toId: "node-2", x: 0, y: 0, width: 0, height: 0 },
    ];
    const groupSelection = new Set(["title", "node", "edge"]);

    expect(getFocusedDiagramObject(objects, groupSelection, "node")).toMatchObject({ id: "node", kind: "graph-node" });
    expect(getFocusedDiagramObject(objects, groupSelection, "title")).toBeUndefined();
    expect(getFocusedDiagramObject(objects, new Set(), "node")).toBeUndefined();
  });
});
