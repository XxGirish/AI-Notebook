import { describe, expect, it } from "vitest";
import type { NotebookObject } from "./notebook";
import { buildLinearReadingItems } from "./linearReading";

describe("linear reading view", () => {
  it("orders semantic content spatially and reads each diagram as one item", () => {
    const objects: NotebookObject[] = [
      { id: "quiz", revision: 1, kind: "quiz-card", x: 0, y: 300, width: 340, height: 260, prompt: "Pick one", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], correctOptionId: "a", rationale: "A" },
      { id: "to", revision: 1, kind: "graph-node", x: 200, y: 100, width: 100, height: 60, label: "Effect" },
      { id: "from", revision: 1, kind: "graph-node", x: 0, y: 100, width: 100, height: 60, label: "Cause" },
      { id: "edge", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "from", toId: "to", label: "produces" },
      { id: "note", revision: 1, kind: "text-card", x: 400, y: 600, width: 200, height: 100, title: "Aside", body: "Why?" },
      { id: "card-link", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "note", toId: "quiz" },
      { id: "ink", revision: 1, kind: "stroke", tool: "pen", color: "#000", size: 4, x: 0, y: 0, width: 10, height: 10, points: [] },
    ];

    const items = buildLinearReadingItems(objects);
    expect(items.map((item) => item.id)).toEqual(["diagram:from", "card-link", "quiz", "note"]);
    expect(items[0].text).toBe("Diagram with 2 nodes: Cause; Effect\nCause to Effect: produces");
    expect(items[2].text).not.toContain("Answer:");
    expect(items[1].text).toBe("Connection from Aside to quiz");
  });
});
