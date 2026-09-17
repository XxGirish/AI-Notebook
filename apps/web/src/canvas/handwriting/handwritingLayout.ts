import type { NotebookObject, StrokeObject } from "../../domain/notebook";

export type InkBounds = { x: number; y: number; width: number; height: number };
export type MeasureText = (text: string, fontSize: number) => number;

export const INK_TEXT_FONT_FAMILY = "Inter, ui-sans-serif, system-ui, sans-serif";
const MAX_TEXT_LENGTH = 500;
const LINE_HEIGHT_RATIO = 1.2;

// Converted-text objects were created by an earlier Pen Pro that recognized
// handwriting; notes that contain them still load, edit and revert to ink.

/** Rough width used when no canvas is available (tests, export). */
export const estimateTextWidth: MeasureText = (text, fontSize) => Math.max(fontSize, text.length * fontSize * 0.56);

export function inkBounds(strokes: StrokeObject[]): InkBounds {
  const left = Math.min(...strokes.map((stroke) => stroke.x));
  const top = Math.min(...strokes.map((stroke) => stroke.y));
  const right = Math.max(...strokes.map((stroke) => stroke.x + stroke.width));
  const bottom = Math.max(...strokes.map((stroke) => stroke.y + stroke.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Splits handwriting into lines so each is neatened on its own. Strokes join
 * a line when they overlap its vertical band; a large horizontal gap on the same
 * band starts a separate line so side-by-side notes are not levelled as one.
 */
export function groupStrokesIntoLines(strokes: StrokeObject[]): StrokeObject[][] {
  type Line = { top: number; bottom: number; strokes: StrokeObject[] };
  const lines: Line[] = [];

  // Tall strokes establish a line's band before dots, dashes and accents join it.
  for (const stroke of [...strokes].sort((a, b) => b.height - a.height || a.x - b.x)) {
    const top = stroke.y;
    const bottom = stroke.y + stroke.height;
    let best: Line | undefined;
    let bestOverlap = 0;
    for (const line of lines) {
      const overlap = Math.min(bottom, line.bottom) - Math.max(top, line.top);
      const ratio = overlap / Math.max(1, Math.min(stroke.height, line.bottom - line.top));
      if (ratio >= 0.4 && ratio > bestOverlap) {
        best = line;
        bestOverlap = ratio;
      }
    }
    if (best) {
      best.strokes.push(stroke);
      best.top = Math.min(best.top, top);
      best.bottom = Math.max(best.bottom, bottom);
    } else {
      lines.push({ top, bottom, strokes: [stroke] });
    }
  }

  const result: StrokeObject[][] = [];
  for (const line of lines.sort((a, b) => a.top - b.top)) {
    const ordered = line.strokes.sort((a, b) => a.x - b.x);
    const maximumGap = Math.max(48, (line.bottom - line.top) * 3);
    let segment: StrokeObject[] = [];
    let segmentRight = -Infinity;
    for (const stroke of ordered) {
      if (segment.length > 0 && stroke.x - segmentRight > maximumGap) {
        result.push(segment);
        segment = [];
        segmentRight = -Infinity;
      }
      segment.push(stroke);
      segmentRight = Math.max(segmentRight, stroke.x + stroke.width);
    }
    if (segment.length > 0) result.push(segment);
  }
  return result;
}

export function normalizeRecognizedText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function textGeometry(text: string, fontSize: number, measureText: MeasureText) {
  return { width: Math.ceil(measureText(text, fontSize)), height: Math.ceil(fontSize * LINE_HEIGHT_RATIO) };
}

export function editInkText(objects: NotebookObject[], id: string, text: string, measureText: MeasureText): NotebookObject[] {
  const normalized = normalizeRecognizedText(text);
  const index = objects.findIndex((object) => object.id === id);
  const current = objects[index];
  if (!normalized || current?.kind !== "ink-text" || current.text === normalized) return objects;
  const next = [...objects];
  next[index] = { ...current, ...textGeometry(normalized, current.fontSize, measureText), text: normalized, revision: current.revision + 1 };
  return next;
}

/**
 * Puts the original handwriting back where the text currently sits. The text's
 * left edge and vertical centre anchor the ink, so moving or editing the text
 * first still restores the strokes in the expected place.
 */
export function restoreHandwriting(
  objects: NotebookObject[],
  id: string,
  allocateId: () => string,
): { objects: NotebookObject[]; restoredIds: string[] } {
  const index = objects.findIndex((object) => object.id === id);
  const inkText = objects[index];
  if (inkText?.kind !== "ink-text") return { objects, restoredIds: [] };

  const source = inkBounds(inkText.sourceStrokes);
  const dx = inkText.x - source.x;
  const dy = inkText.y + inkText.height / 2 - (source.y + source.height / 2);
  const strokes = inkText.sourceStrokes.map((stroke): StrokeObject => ({
    ...structuredClone(stroke),
    id: allocateId(),
    revision: 1,
    groupId: inkText.groupId,
    x: stroke.x + dx,
    y: stroke.y + dy,
    points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
  }));
  const next = [...objects];
  next.splice(index, 1, ...strokes);
  return { objects: next, restoredIds: strokes.map((stroke) => stroke.id) };
}
