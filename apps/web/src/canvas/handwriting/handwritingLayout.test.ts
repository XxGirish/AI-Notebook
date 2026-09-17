import { describe, expect, it } from "vitest";
import type { NotebookObject, StrokeObject } from "../../domain/notebook";
import { convertRecognizedLines, editInkText, estimateTextWidth, groupStrokesIntoLines, restoreHandwriting } from "./handwritingLayout";

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

const options = { allocateId: (index: number) => `text-${index}`, measureText: estimateTextWidth, recognizer: "test-recognizer" };
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

describe("converting recognized handwriting", () => {
  it("replaces the source ink with one text object in its place and keeps the ink inside it", () => {
    const before: NotebookObject = { id: "note", revision: 1, kind: "graph-node", x: 0, y: 0, width: 10, height: 10, label: "Before" };
    const objects: NotebookObject[] = [before, stroke("a", 100, 100, 40, 40), stroke("b", 150, 100, 40, 40), stroke("other", 0, 400, 20, 20)];
    const result = convertRecognizedLines(objects, [{ sources: [{ id: "a", revision: 1 }, { id: "b", revision: 1 }], text: "  hello \n world " }], options);

    expect(result.createdIds).toEqual(["text-0"]);
    expect(result.objects.map((object) => object.id)).toEqual(["note", "text-0", "other"]);
    expect(result.objects[1]).toMatchObject({ kind: "ink-text", text: "hello world", recognizedText: "hello world", x: 100, recognizer: "test-recognizer", color: "#183153" });
    const inkText = result.objects[1];
    if (inkText.kind !== "ink-text") throw new Error("expected ink text");
    expect(inkText.sourceStrokes.map((item) => item.id)).toEqual(["a", "b"]);
    expect(inkText.y + inkText.height / 2).toBeCloseTo(120);
  });

  it("keeps the ink when recognition is empty or a source changed while recognizing", () => {
    const objects: NotebookObject[] = [stroke("a", 0, 0, 40, 40), { ...stroke("b", 0, 100, 40, 40), revision: 2 }];
    const result = convertRecognizedLines(objects, [
      { sources: [{ id: "a", revision: 1 }], text: "   " },
      { sources: [{ id: "b", revision: 1 }], text: "moved" },
      { sources: [{ id: "erased", revision: 1 }], text: "gone" },
    ], options);
    expect(result).toEqual({ objects, createdIds: [] });
  });

  it("never lets two lines claim the same stroke", () => {
    const objects: NotebookObject[] = [stroke("a", 0, 0, 40, 40)];
    const result = convertRecognizedLines(objects, [
      { sources: [{ id: "a", revision: 1 }], text: "first" },
      { sources: [{ id: "a", revision: 1 }], text: "second" },
    ], options);
    expect(result.createdIds).toEqual(["text-0"]);
    expect(result.objects).toHaveLength(1);
  });
});

describe("editing and reverting converted text", () => {
  const converted = convertRecognizedLines([stroke("a", 100, 100, 40, 40)], [{ sources: [{ id: "a", revision: 1 }], text: "helo" }], options).objects;

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
