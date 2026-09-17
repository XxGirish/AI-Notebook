import { describe, expect, it } from "vitest";
import type { NotebookObject, StrokeObject } from "../../domain/notebook";
import { editInkText, estimateTextWidth, groupStrokesIntoLines, restoreHandwriting } from "./handwritingLayout";

const stroke = (id: string, x: number, y: number, width: number, height: number): StrokeObject => ({
  id,
  revision: 1,
  kind: "stroke",
  tool: "pen",
  color: "#183153",
  size: 4,
  x,
  y,
  width,
  height,
  points: [{ x: x + 2, y: y + 2, pressure: 0.5, time: 0 }, { x: x + width - 2, y: y + height - 2, pressure: 0.5, time: 1 }],
});

const ids = (strokes: StrokeObject[][]) => strokes.map((line) => line.map((item) => item.id));

describe("handwriting line grouping", () => {
  it("keeps letters, dots and accents of one written line together in reading order", () => {
    const lines = groupStrokesIntoLines([
      stroke("i-dot", 58, 88, 4, 4),
      stroke("h", 0, 90, 30, 50),
      stroke("i-stem", 55, 105, 6, 35),
      stroke("second-line", 0, 200, 80, 45),
    ]);
    expect(ids(lines)).toEqual([["h", "i-stem", "i-dot"], ["second-line"]]);
  });

  it("separates notes written far apart on the same band", () => {
    const lines = groupStrokesIntoLines([stroke("left", 0, 0, 60, 40), stroke("right", 600, 5, 60, 40)]);
    expect(ids(lines)).toEqual([["left"], ["right"]]);
  });
});

describe("editing and reverting converted text", () => {
  const converted: NotebookObject[] = [{
    id: "text-0",
    revision: 1,
    kind: "ink-text",
    x: 100,
    y: 101,
    width: 90,
    height: 38,
    text: "helo",
    fontSize: 30,
    color: "#183153",
    recognizedText: "helo",
    recognizer: "test-recognizer",
    sourceStrokes: [stroke("a", 100, 100, 40, 40)],
  }];

  it("corrects the text as a new revision and ignores blank edits", () => {
    const edited = editInkText(converted, "text-0", "hello", estimateTextWidth);
    expect(edited[0]).toMatchObject({ text: "hello", recognizedText: "helo", revision: 2 });
    expect(editInkText(edited, "text-0", "   ", estimateTextWidth)).toBe(edited);
  });

  it("restores the original strokes at the text's current position with fresh ids", () => {
    const moved = converted.map((object) => ({ ...object, x: object.x + 50, y: object.y + 20 }));
    let next = 0;
    const restored = restoreHandwriting(moved, "text-0", () => `restored-${++next}`);
    expect(restored.restoredIds).toEqual(["restored-1"]);
    expect(restored.objects).toHaveLength(1);
    expect(restored.objects[0]).toMatchObject({ kind: "stroke", id: "restored-1", revision: 1, x: 150, y: 120 });
    const point = (restored.objects[0] as StrokeObject).points[0];
    expect(point).toMatchObject({ x: 152, y: 122 });
  });
});
