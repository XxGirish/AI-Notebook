import type { NotebookObject, PointSample, StrokeObject } from "../../domain/notebook";
import { groupStrokesIntoLines, inkBounds } from "./handwritingLayout";

type Point = Pick<PointSample, "x" | "y">;

// Lines tilted beyond this are treated as intentional (a diagonal label, an arrow)
// and left at their angle; below the minimum the correction is invisible noise.
const MAX_DESKEW_RADIANS = (20 * Math.PI) / 180;
const MIN_DESKEW_RADIANS = (1 * Math.PI) / 180;
const PRESSURE_EVENING = 0.65;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

/** Evenly spaced samples remove speed-dependent clumping before smoothing. */
function resample(points: PointSample[], spacing: number): PointSample[] {
  const result: PointSample[] = [{ ...points[0] }];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (segment === 0) continue;
    let distance = spacing - carried;
    while (distance <= segment) {
      const t = distance / segment;
      result.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        pressure: from.pressure + (to.pressure - from.pressure) * t,
        time: from.time + (to.time - from.time) * t,
      });
      distance += spacing;
    }
    carried = segment - (distance - spacing);
  }
  const last = points[points.length - 1];
  const tail = result[result.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) result.push({ ...last });
  return result;
}

/** A small [1, 2, 1] kernel irons out tremor while keeping each letter's shape and endpoints. */
function smooth(points: PointSample[], passes: number): PointSample[] {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((point, index) => {
      if (index === 0 || index === current.length - 1) return point;
      const previous = current[index - 1];
      const next = current[index + 1];
      return {
        x: (previous.x + point.x * 2 + next.x) / 4,
        y: (previous.y + point.y * 2 + next.y) / 4,
        pressure: (previous.pressure + point.pressure * 2 + next.pressure) / 4,
        time: point.time,
      };
    });
  }
  return current;
}

/** Least-squares slope through every sample approximates the writing direction. */
export function writingAngle(points: Point[]): number {
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let varianceX = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    varianceX += (point.x - meanX) ** 2;
  }
  return varianceX === 0 ? 0 : Math.atan(covariance / varianceX);
}

function rotate(point: PointSample, center: Point, angle: number): PointSample {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { ...point, x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function withPoints(stroke: StrokeObject, points: PointSample[]): StrokeObject {
  const padding = stroke.size / 2;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    ...stroke,
    revision: stroke.revision + 1,
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2,
    points,
  };
}

/**
 * Neatens one line of handwriting while keeping the writer's own letterforms:
 * levels a tilted line, smooths shaky curves and evens out blotchy pressure.
 * Rotation is rigid and smoothing is local, so letters keep their shape,
 * size and spacing.
 */
export function neatenLine(strokes: StrokeObject[]): StrokeObject[] {
  const bounds = inkBounds(strokes);
  const lineHeight = Math.max(8, bounds.height);
  const samples = strokes.flatMap((stroke) => stroke.points);
  if (samples.length === 0) return strokes;

  let angle = 0;
  if (bounds.width > lineHeight * 1.5) {
    const measured = writingAngle(samples);
    if (Math.abs(measured) >= MIN_DESKEW_RADIANS && Math.abs(measured) <= MAX_DESKEW_RADIANS) angle = measured;
  }
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const spacing = clamp(lineHeight / 40, 0.75, 2);
  // Smoothing reach scales with writing size so small and large notes get the
  // same visual cleanup; each [1, 2, 1] pass adds half a sample of variance.
  const reach = clamp(lineHeight * 0.045, 1.2, 5);
  const passes = Math.min(40, Math.round(2 * (reach / spacing) ** 2));
  const typicalPressure = median(samples.map((point) => point.pressure));

  return strokes.map((stroke) => {
    let points = stroke.points.map((point) => angle === 0 ? { ...point } : rotate(point, center, -angle));
    // Dots and tiny ticks have no curve to improve; smoothing would only shrink them.
    if (points.length >= 3 && pathLength(points) >= spacing * 4) points = smooth(resample(points, spacing), passes);
    points = points.map((point) => ({
      ...point,
      pressure: clamp(point.pressure * (1 - PRESSURE_EVENING) + typicalPressure * PRESSURE_EVENING, 0, 1),
    }));
    return withPoints(stroke, points);
  });
}

/**
 * Applies neatening to the given pen strokes as one document update. Strokes
 * that were erased, moved or otherwise changed since they were written are
 * left untouched, and object IDs are kept so selection and groups still apply.
 */
export function neatenHandwriting(
  objects: NotebookObject[],
  sources: Array<{ id: string; revision: number }>,
): { objects: NotebookObject[]; changedIds: string[] } {
  const expected = new Map(sources.map((source) => [source.id, source.revision]));
  const strokes = objects.filter((object): object is StrokeObject =>
    object.kind === "stroke" && object.tool === "pen" && expected.get(object.id) === object.revision);
  if (strokes.length === 0) return { objects, changedIds: [] };

  const replacements = new Map(groupStrokesIntoLines(strokes).flatMap(neatenLine).map((stroke) => [stroke.id, stroke]));
  return {
    objects: objects.map((object) => replacements.get(object.id) ?? object),
    changedIds: [...replacements.keys()],
  };
}
