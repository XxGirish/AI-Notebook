import type { NotebookObject, TextObject } from "../domain/notebook";
import type { MeasureText } from "./handwriting/handwritingLayout";
import type { CanvasBounds, CanvasPoint, CanvasSize } from "./shapeMath";

// The canvas, the in-place editor and the static export all lay text out with
// these values; changing one without the others makes text jump on commit.
export const TEXT_FONT_FAMILY = "Inter, ui-sans-serif, system-ui, sans-serif";
export const TEXT_LINE_HEIGHT = 1.35;
export const TEXT_PADDING = 6;
export const TEXT_COLOR = "#183153";
export const TEXT_FONT_SIZES = [
  { label: "Small", value: 16 },
  { label: "Medium", value: 20 },
  { label: "Large", value: 28 },
  { label: "Heading", value: 40 },
] as const;
export const DEFAULT_TEXT_FONT_SIZE = 20;
export const DEFAULT_TEXT_WIDTH = 240;
export const MIN_TEXT_WIDTH = 40;
export const MAX_TEXT_LENGTH = 10_000;

/** Height of one line of text plus the box padding: the smallest a box can be. */
export const minimumTextHeight = (fontSize: number) => fontSize * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;

/** Stored text keeps the writer's indentation and blank lines, but not trailing whitespace. */
export const normalizeText = (text: string) => text.slice(0, MAX_TEXT_LENGTH).replace(/\s+$/, "");

function breakLongWord(word: string, maxWidth: number, fontSize: number, measure: MeasureText): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    if (piece && measure(piece + character, fontSize) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece += character;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Greedy word wrap, matching Konva's `wrap="word"`: explicit newlines always
 * break, words move to the next line when they overflow, and a single word
 * wider than the box is split by character.
 */
export function wrapTextLines(text: string, maxWidth: number, fontSize: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      const pieces = breakLongWord(word, maxWidth, fontSize, measure);
      lines.push(...pieces.slice(0, -1));
      line = pieces.at(-1) ?? "";
    }
    lines.push(line);
  }
  return lines;
}

export function textContentHeight(text: string, width: number, fontSize: number, measure: MeasureText): number {
  const lines = wrapTextLines(text, Math.max(1, width - TEXT_PADDING * 2), fontSize, measure);
  return lines.length * fontSize * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;
}

/** A box never hides its text: it keeps the height the writer gave it, or grows to fit. */
export function fittedTextHeight(text: string, size: CanvasSize, fontSize: number, measure: MeasureText): number {
  return Math.max(size.height, textContentHeight(text, size.width, fontSize, measure));
}

/** The box a Text-tool press or drag should open, before anything is typed. */
export function textBoxFromGesture(start: CanvasPoint, end: CanvasPoint, fontSize: number, dragThreshold: number): CanvasBounds {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const minimumHeight = minimumTextHeight(fontSize);
  // A press without a drag places a one-line box with the caret where the writer tapped.
  if (width < dragThreshold && height < dragThreshold) {
    return { x: start.x - TEXT_PADDING, y: start.y - minimumHeight / 2, width: DEFAULT_TEXT_WIDTH, height: minimumHeight };
  }
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(MIN_TEXT_WIDTH, width),
    height: Math.max(minimumHeight, height),
  };
}

/** Returns undefined for blank text: an empty box is not worth keeping. */
export function createTextObject(
  id: string,
  bounds: CanvasBounds,
  text: string,
  fontSize: number,
  measure: MeasureText,
): TextObject | undefined {
  const normalized = normalizeText(text);
  if (!normalized.trim()) return undefined;
  return {
    id,
    revision: 1,
    kind: "text",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: fittedTextHeight(normalized, bounds, fontSize, measure),
    text: normalized,
    fontSize,
    color: TEXT_COLOR,
  };
}

/** Saves an edit. Clearing all the text deletes the box; an unchanged edit is not a history step. */
export function editTextObject(objects: NotebookObject[], id: string, text: string, measure: MeasureText): NotebookObject[] {
  const current = objects.find((object) => object.id === id);
  if (current?.kind !== "text") return objects;
  const normalized = normalizeText(text);
  if (!normalized.trim()) return objects.filter((object) => object.id !== id);
  if (normalized === current.text) return objects;
  return objects.map((object) => object.id === id && object.kind === "text"
    ? {
      ...object,
      text: normalized,
      height: fittedTextHeight(normalized, object, object.fontSize, measure),
      revision: object.revision + 1,
    }
    : object);
}

export function setTextFontSize(objects: NotebookObject[], id: string, fontSize: number, measure: MeasureText): NotebookObject[] {
  const current = objects.find((object) => object.id === id);
  if (current?.kind !== "text" || current.fontSize === fontSize) return objects;
  return objects.map((object) => object.id === id && object.kind === "text"
    ? {
      ...object,
      fontSize,
      // Shrinking the font keeps the box; growing it must not clip the text.
      height: fittedTextHeight(object.text, object, fontSize, measure),
      revision: object.revision + 1,
    }
    : object);
}

/** Size for the bottom-right resize handle: text rewraps and the box cannot shrink below it. */
export function resizeTextBox(handle: CanvasPoint, object: TextObject, measure: MeasureText): CanvasSize {
  const width = Math.max(MIN_TEXT_WIDTH, handle.x);
  const height = Math.max(handle.y, textContentHeight(object.text, width, object.fontSize, measure));
  return { width, height };
}

/** The topmost text box under a point, so the Text tool can reopen it instead of stacking a new one. */
export function textObjectAt(objects: NotebookObject[], point: CanvasPoint): TextObject | undefined {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (
      object.kind === "text"
      && point.x >= object.x && point.x <= object.x + object.width
      && point.y >= object.y && point.y <= object.y + object.height
    ) {
      return object;
    }
  }
  return undefined;
}
