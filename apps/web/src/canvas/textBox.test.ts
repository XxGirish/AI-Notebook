import { describe, expect, it } from "vitest";
import type { NotebookObject, TextObject } from "../domain/notebook";
import {
  createTextObject,
  DEFAULT_TEXT_WIDTH,
  editTextObject,
  MIN_TEXT_WIDTH,
  minimumTextHeight,
  resizeTextBox,
  setTextFontSize,
  textBoxFromGesture,
  textContentHeight,
  textObjectAt,
  TEXT_LINE_HEIGHT,
  TEXT_PADDING,
  wrapTextLines,
} from "./textBox";

// Every character is 10 units wide, so wrapping is easy to reason about.
const measure = (text: string) => text.length * 10;

const textObject = (overrides: Partial<TextObject> = {}): TextObject => ({
  id: "text-1",
  revision: 1,
  kind: "text",
  x: 0,
  y: 0,
  width: 112,
  height: minimumTextHeight(20),
  text: "hello",
  fontSize: 20,
  color: "#183153",
  ...overrides,
});

describe("wrapTextLines", () => {
  it("wraps words to the width and keeps explicit line breaks", () => {
    expect(wrapTextLines("one two three", 70, 20, measure)).toEqual(["one two", "three"]);
    expect(wrapTextLines("a\n\nb", 100, 20, measure)).toEqual(["a", "", "b"]);
  });

  it("splits a word wider than the box without swallowing the next word", () => {
    expect(wrapTextLines("abcdefgh ij", 40, 20, measure)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("text box geometry", () => {
  it("opens a default one-line box on a tap and the dragged box otherwise", () => {
    const tap = textBoxFromGesture({ x: 100, y: 100 }, { x: 102, y: 101 }, 20, 8);
    expect(tap).toMatchObject({ width: DEFAULT_TEXT_WIDTH, height: minimumTextHeight(20) });
    expect(tap.y + tap.height / 2).toBe(100);

    expect(textBoxFromGesture({ x: 300, y: 200 }, { x: 100, y: 100 }, 20, 8)).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(textBoxFromGesture({ x: 0, y: 0 }, { x: 20, y: 10 }, 20, 8)).toMatchObject({ width: MIN_TEXT_WIDTH, height: minimumTextHeight(20) });
  });

  it("grows a box to fit its text but never shrinks it below what was drawn", () => {
    const tall = createTextObject("t", { x: 0, y: 0, width: 112, height: 200 }, "hi", 20, measure)!;
    expect(tall.height).toBe(200);
    const long = createTextObject("t", { x: 0, y: 0, width: 92, height: 10 }, "one two three four", 20, measure)!;
    expect(long.height).toBe(textContentHeight("one two three four", 92, 20, measure));
    expect(long.height).toBe(3 * 20 * TEXT_LINE_HEIGHT + TEXT_PADDING * 2);
  });

  it("does not let the resize handle hide text", () => {
    const object = textObject({ text: "one two three four" });
    expect(resizeTextBox({ x: 10, y: 5 }, object, measure)).toEqual({ width: MIN_TEXT_WIDTH, height: textContentHeight(object.text, MIN_TEXT_WIDTH, 20, measure) });
    expect(resizeTextBox({ x: 400, y: 300 }, object, measure)).toEqual({ width: 400, height: 300 });
  });
});

describe("text commands", () => {
  it("does not create a box for blank text and trims trailing whitespace", () => {
    expect(createTextObject("t", { x: 0, y: 0, width: 100, height: 40 }, "  \n ", 20, measure)).toBeUndefined();
    expect(createTextObject("t", { x: 0, y: 0, width: 100, height: 40 }, "  indented\n\n", 20, measure)?.text).toBe("  indented");
  });

  it("edits text as a new revision, deletes a cleared box and ignores unchanged edits", () => {
    const objects: NotebookObject[] = [textObject()];
    const edited = editTextObject(objects, "text-1", "hello world again", measure);
    expect(edited[0]).toMatchObject({ text: "hello world again", revision: 2 });
    expect(edited[0].height).toBeGreaterThan(objects[0].height);
    expect(editTextObject(objects, "text-1", "   ", measure)).toEqual([]);
    expect(editTextObject(objects, "text-1", "hello  ", measure)).toBe(objects);
  });

  it("changes the font size and refits the box", () => {
    const objects: NotebookObject[] = [textObject()];
    const larger = setTextFontSize(objects, "text-1", 40, measure);
    expect(larger[0]).toMatchObject({ fontSize: 40, revision: 2, height: minimumTextHeight(40) });
    expect(setTextFontSize(objects, "text-1", 20, measure)).toBe(objects);
  });

  it("finds the topmost text box under a point", () => {
    const below = textObject({ id: "below" });
    const above = textObject({ id: "above" });
    expect(textObjectAt([below, above], { x: 10, y: 10 })?.id).toBe("above");
    expect(textObjectAt([below, above], { x: 500, y: 10 })).toBeUndefined();
  });
});
