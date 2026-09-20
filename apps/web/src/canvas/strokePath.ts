import { getStrokeOutlinePoints, type StrokePoint } from "perfect-freehand";
import type { PointSample, StrokeObject } from "../domain/notebook";

type InkPoint = Pick<PointSample, "x" | "y" | "pressure">;

/**
 * Stroke geometry is drawn straight through the writer's samples.
 *
 * perfect-freehand's own point pass (`getStrokePoints`) is deliberately not
 * used. Its `streamline` is an exponential moving average, which makes the
 * rendered tip trail the pen and cuts the corners of every loop, and it drops
 * the first `size` units of each stroke to hide noise. On small cursive those
 * three effects removed about a quarter of the ink (measured against the true
 * path; see docs/decisions/0007-ink-latency-fidelity-and-neatening.md). The one
 * systematic digitizer error, the diagonal wobble of capacitive pens, is taken
 * out when the stroke is captured (digitizerWobble.ts), so the only processing
 * left here is interpolation between samples, which restores the curvature
 * that straight chords lose when samples are sparse (60 Hz touch, fast writing).
 */
const OUTLINE_OPTIONS = {
  pen: { thinning: 0.68, smoothing: 0.15 },
  highlighter: { thinning: 0, smoothing: 0.3 },
} as const;

/** Width of the drawn stroke at a given pressure (perfect-freehand's radius rule, doubled). */
export function strokeWidthAt(size: number, pressure: number, tool: StrokeObject["tool"] = "pen"): number {
  return 2 * size * (0.5 - OUTLINE_OPTIONS[tool].thinning * (0.5 - pressure));
}

/** Interpolated points are at most this far apart, relative to the stroke size. */
const interpolationSpacing = (size: number) => Math.min(1, Math.max(0.25, size * 0.1));

/**
 * Centripetal Catmull-Rom through every sample. The centripetal form
 * (alpha = 0.5) never overshoots or forms a cusp inside a segment, so it adds
 * no loop the writer did not draw, and it passes exactly through each sample,
 * so it cannot lag or shrink the stroke.
 */
export function interpolateSamples(points: InkPoint[], spacing: number): InkPoint[] {
  if (points.length < 3) return points;
  const result: InkPoint[] = [points[0]];
  const knot = (a: InkPoint, b: InkPoint) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const last = points.length - 1;

  for (let index = 0; index < last; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    // Phantom end points continue the first and last segments straight on.
    const p0 = index > 0 ? points[index - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, pressure: p1.pressure };
    const p3 = index + 2 <= last ? points[index + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, pressure: p2.pressure };
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));

    for (let step = 1; step <= steps; step += 1) {
      if (step === steps) {
        result.push(p2);
        break;
      }
      const t = t1 + ((t2 - t1) * step) / steps;
      const mix = (a: number, b: number, ta: number, tb: number) => ((tb - t) * a + (t - ta) * b) / (tb - ta);
      const a1x = mix(p0.x, p1.x, 0, t1), a1y = mix(p0.y, p1.y, 0, t1);
      const a2x = mix(p1.x, p2.x, t1, t2), a2y = mix(p1.y, p2.y, t1, t2);
      const a3x = mix(p2.x, p3.x, t2, t3), a3y = mix(p2.y, p3.y, t2, t3);
      const b1x = mix(a1x, a2x, 0, t2), b1y = mix(a1y, a2y, 0, t2);
      const b2x = mix(a2x, a3x, t1, t3), b2y = mix(a2y, a3y, t1, t3);
      const u = step / steps;
      result.push({
        x: mix(b1x, b2x, t1, t2),
        y: mix(b1y, b2y, t1, t2),
        pressure: p1.pressure + (p2.pressure - p1.pressure) * u,
      });
    }
  }
  return result;
}

function toStrokePoints(points: InkPoint[]): StrokePoint[] {
  const result: StrokePoint[] = [];
  let runningLength = 0;
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous) {
      result.push({ point: [point.x, point.y], pressure: point.pressure, vector: [1, 1], distance: 0, runningLength: 0 });
      continue;
    }
    const dx = previous.point[0] - point.x;
    const dy = previous.point[1] - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) continue;
    runningLength += distance;
    result.push({ point: [point.x, point.y], pressure: point.pressure, vector: [dx / distance, dy / distance], distance, runningLength });
  }
  if (result.length > 1) result[0].vector = result[1].vector;
  return result;
}

/** Outline polygon of a stroke, in the same coordinates as its points. */
export function getStrokeOutline(points: InkPoint[], size: number, tool: StrokeObject["tool"] = "pen"): number[][] {
  if (points.length === 0) return [];
  const strokePoints = toStrokePoints(interpolateSamples(points, interpolationSpacing(size)));
  return getStrokeOutlinePoints(strokePoints, {
    size,
    ...OUTLINE_OPTIONS[tool],
    simulatePressure: false,
    easing: (pressure) => pressure,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    // Every render ends the stroke exactly at its newest sample, so the live
    // tip sits under the pen and the finished stroke matches what was drawn.
    last: true,
  });
}

export function outlineToSvgPath(outline: number[][]): string {
  if (outline.length < 3) return "";
  const round = (value: number) => Math.round(value * 100) / 100;
  let path = `M ${round(outline[0][0])} ${round(outline[0][1])} Q`;
  for (let index = 1; index < outline.length; index += 1) {
    const point = outline[index];
    const next = outline[(index + 1) % outline.length];
    path += ` ${round(point[0])} ${round(point[1])} ${round((point[0] + next[0]) / 2)} ${round((point[1] + next[1]) / 2)}`;
  }
  return `${path} Z`;
}

export function getStrokePath(points: InkPoint[], size: number, tool: StrokeObject["tool"] = "pen"): string {
  return outlineToSvgPath(getStrokeOutline(points, size, tool));
}
