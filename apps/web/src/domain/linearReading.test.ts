import { describe, expect, it } from "vitest";
import type { NotebookObject } from "./notebook";
import { buildLinearReadingItems } from "./linearReading";

describe("linear reading view", () => {
  it("orders semantic content spatially and describes diagram bindings", () => {
    const objects: NotebookObject[] = [
      { id: "quiz", revision: 1, kind: "quiz-card", x: 0, y: 300, width: 340, height: 260, prompt: "Pick one", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctOptionId: "a", rationale: "A" },
      { id: "to", revision: 1, kind: "graph-node", x: 200, y: 100, width: 100, height: 60, label: "Effect" },
      { id: "from", revision: 1, kind: "graph-node", x: 0, y: 100, width: 100, height: 60, label: "Cause" },
      { id: "edge", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "from", toId: "to", label: "produces" },
      { id: "ink", revision: 1, kind: "stroke", tool: "pen", color: "#000", size: 4, x: 0, y: 0, width: 10, height: 10, points: [] },
    ];

    const items = buildLinearReadingItems(objects);
    expect(items.map((item) => item.id)).toEqual(["edge", "from", "to", "quiz"]);
    expect(items[0].text).toBe("Connection from Cause to Effect: produces");
    expect(items.at(-1)?.text).not.toContain("Answer:");
  });
});
