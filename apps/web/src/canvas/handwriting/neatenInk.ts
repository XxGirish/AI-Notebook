import type { NotebookObject, PointSample, StrokeObject } from "../../domain/notebook";
import { groupStrokesIntoLines, inkBounds } from "./handwritingLayout";

/**
 * Pen Pro neatening.
 *
 * Handwriting looks messy mostly because of inconsistency *between* words, not
 * because of the letterforms themselves: words drift above and below the line,
 * change size, lean at different angles and sit at uneven distances. These are
 * the variations that handwriting-recognition preprocessing removes (skew,
 * baseline, slant and size normalization; e.g. Simard, Steinkraus & Agrawala,
 * "Ink normalization and beautification", ICDAR 2005), and they are what the
 * eye reads as "neat".
 *
 * Each word gets one affine transform (rotation, shear, uniform scale,
 * translation), so its letters keep the writer's own shapes; only the
 * relationship between words changes. Tremor is then removed with a smoothing
 * filter that does not shrink loops. All measurements are robust (medians,
 * modes, Theil–Sen), because ascenders, descenders, dots and crossbars are
 * always present and are exactly the outliers a mean would follow.
 */

type Point = { x: number; y: number };
/** x' = a x + c y + e, y' = b x + d y + f (the canvas convention). */
type Affine = readonly [number, number, number, number, number, number];

// Lines tilted more than this are deliberate (a diagonal label) and keep their angle.
const MAX_LEVEL_RADIANS = (20 * Math.PI) / 180;
// A single word's residual tilt is corrected only within this range.
const MAX_WORD_TILT_RADIANS = (10 * Math.PI) / 180;
// Slant differences beyond this are probably not the same writing style.
const MAX_SLANT_CORRECTION_RADIANS = (20 * Math.PI) / 180;
// Estimates of a word's slant and tilt depend a little on which letters it
// contains (about ±2° and ±0.3° on clean writing). Only the part of a deviation
// beyond that noise is corrected, so neat writing is left as it is.
const SLANT_DEAD_ZONE_RADIANS = (3 * Math.PI) / 180;
const TILT_DEAD_ZONE_RADIANS = (1 * Math.PI) / 180;
// Words whose x-height differs from the line's by more than these factors are
// capitals, digits or a deliberately larger word, and keep their size.
const MIN_SIZE_RATIO = 0.7;
const MAX_SIZE_RATIO = 1.45;
const PRESSURE_EVENING = 0.65;
// Gaps wider than this many x-heights separate words.
const WORD_GAP = 0.55;
// Taubin passes over samples x-height/16 apart: damps wobble shorter than
// roughly a fifth of the letter height, keeps letter-scale curves.
const SMOOTHING_PASSES = 6;

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
/** Shrinks `value` toward zero by `zone`: deviations inside the zone vanish. */
const beyond = (value: number, zone: number) => Math.sign(value) * Math.max(0, Math.abs(value) - zone);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let running = 0;
  for (const entry of sorted) {
    running += entry.weight;
    if (running >= half) return entry.value;
  }
  return sorted[sorted.length - 1].value;
}

/** Composition: apply `inner` first, then `outer`. */
function compose(outer: Affine, inner: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

const apply = (m: Affine, point: Point): Point => ({ x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] });
const translation = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];
const rotationAbout = (angle: number, center: Point): Affine => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, center.x - cos * center.x + sin * center.y, center.y - sin * center.x - cos * center.y];
};
const scaleAbout = (scale: number, center: Point): Affine => [scale, 0, 0, scale, center.x * (1 - scale), center.y * (1 - scale)];
/** Leans ink right by `amount` per unit of height above `baseline` (y grows downward). */
const shearAbove = (amount: number, baseline: number): Affine => [1, 0, -amount, 1, amount * baseline, 0];

function pathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

/** Evenly spaced samples, so filters act on distance along the ink rather than on pen speed. */
export function resample(points: PointSample[], spacing: number): PointSample[] {
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

/**
 * Sharp turns — the top of an n, the point of a v, a retrace — are part of the
 * letter; smoothing must not round them. A corner is a local maximum of the
 * turning angle measured over `reach` samples on either side.
 */
function findCorners(points: Point[], reach: number): Set<number> {
  const corners = new Set<number>();
  const turning = points.map((point, index) => {
    if (index < reach || index + reach >= points.length) return 0;
    const before = points[index - reach];
    const after = points[index + reach];
    const incoming = Math.atan2(point.y - before.y, point.x - before.x);
    const outgoing = Math.atan2(after.y - point.y, after.x - point.x);
    return Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
  });
  for (let index = 1; index < points.length - 1; index += 1) {
    if (turning[index] > (75 * Math.PI) / 180 && turning[index] >= turning[index - 1] && turning[index] >= turning[index + 1]) {
      corners.add(index);
    }
  }
  return corners;
}

/**
 * Taubin λ|μ smoothing: each pass shrinks (λ) and then re-inflates (μ), which
 * removes high-frequency tremor while leaving the low-frequency shape — the
 * size of a loop — unchanged. A plain moving average shrinks every loop a
 * little on every pass, which on small writing closes the loops of e and l.
 */
export function taubinSmooth<T extends Point>(points: T[], iterations: number, pinned: Set<number> = new Set()): T[] {
  let current = points;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const factor of [0.5, -0.53]) {
      const source = current;
      current = source.map((point, index) => {
        if (index === 0 || index === source.length - 1 || pinned.has(index)) return point;
        const previous = source[index - 1];
        const next = source[index + 1];
        return {
          ...point,
          x: point.x + factor * ((previous.x + next.x) / 2 - point.x),
          y: point.y + factor * ((previous.y + next.y) / 2 - point.y),
        };
      });
    }
  }
  return current;
}

/** Drops points that lie within `tolerance` of the line through the points kept around them. */
function simplify(points: PointSample[], tolerance: number): PointSample[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = points[start];
    const b = points[end];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let farthest = -1;
    let distance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const p = points[index];
      const d = length === 0
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / length;
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

type Turn = Point & { kind: "top" | "bottom" };

/**
 * Turning points of a stroke's height, in drawing order: the bottoms and tops
 * of letters. A turn only counts once the ink has moved back by `prominence`,
 * so tremor and tiny hooks do not register. Stroke ends count too — the foot
 * of an l or the top of a d's stem are often where the pen lifted.
 */
export function verticalTurns(points: Point[], prominence: number): Turn[] {
  const turns: Turn[] = [];
  if (points.length === 0) return turns;
  let direction: -1 | 0 | 1 = 0; // 1: moving down the page, -1: moving up
  let top = { point: points[0], index: 0 };
  let bottom = { point: points[0], index: 0 };
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (direction === 0) {
      if (point.y < top.point.y) top = { point, index };
      if (point.y > bottom.point.y) bottom = { point, index };
      if (bottom.point.y - top.point.y > prominence) {
        // Whichever extreme came first has been left behind: that one is a turn.
        if (top.index < bottom.index) {
          turns.push({ x: top.point.x, y: top.point.y, kind: "top" });
          direction = 1;
        } else {
          turns.push({ x: bottom.point.x, y: bottom.point.y, kind: "bottom" });
          direction = -1;
        }
      }
    } else if (direction === 1) {
      if (point.y > bottom.point.y) bottom = { point, index };
      else if (bottom.point.y - point.y > prominence) {
        turns.push({ x: bottom.point.x, y: bottom.point.y, kind: "bottom" });
        direction = -1;
        top = { point, index };
      }
    } else if (point.y < top.point.y) {
      top = { point, index };
    } else if (point.y - top.point.y > prominence) {
      turns.push({ x: top.point.x, y: top.point.y, kind: "top" });
      direction = 1;
      bottom = { point, index };
    }
  }
  if (direction === 1) turns.push({ x: bottom.point.x, y: bottom.point.y, kind: "bottom" });
  else if (direction === -1) turns.push({ x: top.point.x, y: top.point.y, kind: "top" });
  return turns;
}

/**
 * Typical x-height: the median rise or fall between consecutive turns. Most
 * strokes of handwriting run between the baseline and the midline (the humps
 * of n and m, the loops of e); ascenders and descenders are a minority. Each
 * rise is measured locally, so a tilted line does not inflate it.
 */
export function estimateXHeight(strokes: Point[][], prominence: number): number | undefined {
  const legs: number[] = [];
  for (const stroke of strokes) {
    const turns = verticalTurns(stroke, prominence);
    for (let index = 1; index < turns.length; index += 1) legs.push(Math.abs(turns[index].y - turns[index - 1].y));
  }
  return legs.length >= 2 ? median(legs) : undefined;
}

/**
 * The value most others agree with: the median of the densest window of width
 * `band`. Baselines and midlines are read this way, because descenders and
 * ascenders are a minority that would still drag a mean or a plain median.
 */
function modalValue(values: number[], band: number): { value: number; support: number } {
  if (values.length === 0) return { value: 0, support: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  let best = { start: 0, end: 0 };
  let end = 0;
  for (let start = 0; start < sorted.length; start += 1) {
    end = Math.max(end, start);
    while (end + 1 < sorted.length && sorted[end + 1] - sorted[start] <= band) end += 1;
    if (end - start > best.end - best.start) best = { start, end };
  }
  return { value: median(sorted.slice(best.start, best.end + 1)), support: best.end - best.start + 1 };
}

/** Theil–Sen slope over point pairs at least `minimumSpan` apart horizontally. */
function robustSlope(points: Point[], minimumSpan: number): number | undefined {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j].x - points[i].x;
      if (Math.abs(dx) >= minimumSpan) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length >= 3 ? median(slopes) : undefined;
}

/** Least-squares slope through every sample; the fallback writing direction. */
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

/**
 * Dominant lean of the downstrokes, as horizontal travel per unit of height;
 * positive leans right. Only ink moving down the page counts: downstrokes are
 * the stable, deliberate part of a letter, while upstrokes and connectors vary
 * with the neighbouring letters (measured: using both left twice the slant
 * scatter). Length-weighted median; near-horizontal ink is ignored.
 */
function slantOf(strokes: Point[][]): { slant: number; support: number } {
  const samples: Array<{ value: number; weight: number }> = [];
  const steepest = Math.tan((40 * Math.PI) / 180);
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      const dx = stroke[index].x - stroke[index - 1].x;
      const dy = stroke[index].y - stroke[index - 1].y;
      const length = Math.hypot(dx, dy);
      if (length === 0 || dy <= 0 || Math.abs(dx) > dy * steepest) continue;
      // A downstroke leaning right ends further left than it started.
      samples.push({ value: -dx / dy, weight: length });
    }
  }
  const support = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return { slant: samples.length > 0 ? weightedMedian(samples) : 0, support };
}

type WordShape = {
  left: number;
  right: number;
  width: number;
  /** Slope of the word's own baseline in the line frame. */
  tilt?: number;
  baseline?: number;
  xHeight?: number;
  slant?: number;
};

/**
 * Splits a line into words. Strokes that overlap horizontally (a dot over its
 * i, a crossbar through its t) always belong together; otherwise a gap wider
 * than `threshold` separates words.
 */
export function segmentWords<T extends { x: number; width: number }>(strokes: T[], threshold: number): T[][] {
  const words: T[][] = [];
  let right = -Infinity;
  for (const stroke of [...strokes].sort((a, b) => a.x - b.x)) {
    if (words.length === 0 || stroke.x - right > threshold) {
      words.push([stroke]);
      right = stroke.x + stroke.width;
    } else {
      words[words.length - 1].push(stroke);
      right = Math.max(right, stroke.x + stroke.width);
    }
  }
  return words;
}

/** Dots, commas and ticks: they ride along with their word and are never measured. */
function isMark(points: Point[], xHeight: number): boolean {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) < xHeight * 0.6
    && Math.max(...ys) - Math.min(...ys) < xHeight * 0.6
    && pathLength(points) < xHeight * 1.2;
}

/**
 * Baseline, x-height, tilt and slant of one word. The baseline is where most
 * letter bottoms sit and the midline where most tops sit; descenders,
 * ascenders and stroke ends that stop mid-letter fall outside the densest band.
 */
function measureWord(points: Point[][], xHeight: number): WordShape {
  const all = points.flat();
  const left = Math.min(...all.map((point) => point.x));
  const right = Math.max(...all.map((point) => point.x));
  const shape: WordShape = { left, right, width: right - left };
  const body = points.filter((stroke) => !isMark(stroke, xHeight));
  if (body.length === 0) return shape;

  const turns = body.flatMap((stroke) => verticalTurns(stroke, xHeight * 0.3));
  const bottoms = turns.filter((turn) => turn.kind === "bottom");
  const tops = turns.filter((turn) => turn.kind === "top");
  if (bottoms.length >= 3 && shape.width >= xHeight * 2) shape.tilt = robustSlope(bottoms, xHeight * 0.6);

  // Heights are read as if the word were level, so a tilted word is not read as taller.
  const tilt = shape.tilt ?? 0;
  const middle = (left + right) / 2;
  const level = (point: Point) => point.y - tilt * (point.x - middle);
  const band = xHeight * 0.25;
  const baseline = modalValue(bottoms.map(level), band);
  const midline = modalValue(tops.map(level), band);
  if (baseline.support >= 2) shape.baseline = baseline.value;
  if (baseline.support >= 2 && midline.support >= 2) {
    const height = baseline.value - midline.value;
    if (height > xHeight * 0.4 && height < xHeight * 2.2) shape.xHeight = height;
  }

  // Slant is read on the straightened word, the way it will be corrected.
  const upright = shape.tilt !== undefined && shape.baseline !== undefined
    ? rotationAbout(-Math.atan(shape.tilt), { x: middle, y: shape.baseline })
    : IDENTITY;
  const slant = slantOf(body.map((stroke) => stroke.map((point) => apply(upright, point))));
  if (slant.support >= xHeight * 1.2) shape.slant = slant.slant;
  return shape;
}

type MeasuredWord<T> = { members: T[]; points: Point[][]; shape: WordShape };

function measureWords<T>(entries: Array<{ member: T; points: Point[] }>, xHeight: number): Array<MeasuredWord<T>> {
  const boxed = entries.filter((entry) => entry.points.length > 0).map((entry) => {
    const xs = entry.points.map((point) => point.x);
    return { ...entry, x: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs) };
  });
  return segmentWords(boxed, xHeight * WORD_GAP).map((group) => {
    const points = group.map((entry) => entry.points);
    return { members: group.map((entry) => entry.member), points, shape: measureWord(points, xHeight) };
  });
}

/** Tremor removal on evenly spaced samples, with the letter's sharp turns held in place. */
function smoothStroke(points: PointSample[], spacing: number, xHeight: number): PointSample[] {
  if (points.length < 3 || pathLength(points) < spacing * 4) return points.map((point) => ({ ...point }));
  const even = resample(points, spacing);
  // Corners are found on a smoothed copy: on the raw ink, tremor itself reads
  // as a string of sharp turns, and pinning those would protect the noise.
  const reach = Math.max(2, Math.round((xHeight * 0.15) / spacing));
  const corners = findCorners(taubinSmooth(even, SMOOTHING_PASSES), reach);
  return taubinSmooth(even, SMOOTHING_PASSES, corners);
}

export type LineContext = {
  /** Already-written words on the same line; they set the targets and are not moved. */
  references: StrokeObject[];
};

/**
 * Neatens one line of handwriting: levels it, puts every word on one baseline,
 * evens word size, slant and spacing, and removes tremor. Words written earlier
 * on the same line (`context.references`) define the targets, so writing added
 * in bursts lines up with what is already there.
 */
export function neatenLine(strokes: StrokeObject[], context: LineContext = { references: [] }): StrokeObject[] {
  if (strokes.length === 0) return strokes;
  const bounds = inkBounds(strokes);
  const lineHeight = Math.max(8, bounds.height);
  const raw = strokes.map((stroke) => stroke.points);
  const xHeight = estimateXHeight(raw, lineHeight * 0.08) ?? lineHeight / 2;
  const spacing = clamp(xHeight / 16, 0.3, 2);
  const smoothed = new Map(strokes.map((stroke) => [stroke.id, smoothStroke(stroke.points, spacing, xHeight)]));

  // 1. The line's direction: Theil–Sen through letter bottoms. Descender
  //    bottoms are too few to move a median of pairwise slopes.
  let lineAngle = 0;
  if (bounds.width > xHeight * 3) {
    const bottoms = strokes.flatMap((stroke) => {
      const points = smoothed.get(stroke.id)!;
      return isMark(points, xHeight) ? [] : verticalTurns(points, xHeight * 0.3).filter((turn) => turn.kind === "bottom");
    });
    const slope = robustSlope(bottoms, xHeight);
    lineAngle = slope !== undefined ? Math.atan(slope) : writingAngle(strokes.flatMap((stroke) => smoothed.get(stroke.id)!));
  }
  const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  // Everything below happens in the line's own frame. A level-ish line comes
  // out level; a deliberately steep one is tidied along its own angle.
  const intoLine = rotationAbout(-lineAngle, centre);
  const outOfLine = Math.abs(lineAngle) > MAX_LEVEL_RADIANS ? rotationAbout(lineAngle, centre) : IDENTITY;
  const inLine = (points: Point[]) => points.map((point) => apply(intoLine, point));

  // 2. Words, measured in the line frame.
  const words = measureWords(strokes.map((stroke) => ({ member: stroke, points: inLine(smoothed.get(stroke.id)!) })), xHeight);
  const earlier = measureWords(context.references.map((stroke) => ({ member: stroke, points: inLine(stroke.points) })), xHeight)
    .map((word) => word.shape);
  const shapes = words.map((word) => word.shape);

  // 3. Targets. Words already on this line win, so a new burst joins them.
  const anchored = earlier.some((shape) => shape.baseline !== undefined);
  const pick = (key: "baseline" | "xHeight" | "slant", from: WordShape[]) => {
    const entries = from.filter((shape) => shape[key] !== undefined).map((shape) => ({ value: shape[key]!, weight: Math.max(1, shape.width) }));
    return entries.length > 0 ? weightedMedian(entries) : undefined;
  };
  const targetBaseline = pick("baseline", anchored ? earlier : shapes);
  const targetXHeight = (anchored ? pick("xHeight", earlier) : undefined) ?? pick("xHeight", shapes);
  const targetSlant = (anchored ? pick("slant", earlier) : undefined) ?? pick("slant", shapes);

  // 4. One transform per word: straighten it, match the slant and size, and
  //    sit it on the baseline. Rotation, shear and scale all pivot on the
  //    word's own baseline, so no step disturbs what an earlier one measured.
  const transforms: Affine[] = shapes.map((shape) => {
    const baseline = shape.baseline;
    if (baseline === undefined) return IDENTITY;
    const pivot = { x: (shape.left + shape.right) / 2, y: baseline };
    let transform: Affine = IDENTITY;
    if (shape.tilt !== undefined && Math.abs(Math.atan(shape.tilt)) <= MAX_WORD_TILT_RADIANS) {
      transform = rotationAbout(-beyond(Math.atan(shape.tilt), TILT_DEAD_ZONE_RADIANS), pivot);
    }
    if (targetSlant !== undefined && shape.slant !== undefined) {
      const difference = Math.atan(targetSlant) - Math.atan(shape.slant);
      if (Math.abs(difference) <= MAX_SLANT_CORRECTION_RADIANS) {
        const corrected = Math.tan(Math.atan(shape.slant) + beyond(difference, SLANT_DEAD_ZONE_RADIANS));
        transform = compose(shearAbove(corrected - shape.slant, baseline), transform);
      }
    }
    if (targetXHeight !== undefined && shape.xHeight !== undefined) {
      const ratio = targetXHeight / shape.xHeight;
      if (ratio >= MIN_SIZE_RATIO && ratio <= MAX_SIZE_RATIO) transform = compose(scaleAbout(ratio, pivot), transform);
    }
    if (targetBaseline !== undefined) transform = compose(translation(0, targetBaseline - baseline), transform);
    return transform;
  });

  // Symbols and words too short to measure (a dash, an equals sign, a lone
  // digit) follow their neighbours up or down rather than being forced onto
  // the baseline or left behind.
  shapes.forEach((shape, index) => {
    if (shape.baseline !== undefined) return;
    const neighbours = shapes
      .map((other, otherIndex) => ({ other, otherIndex }))
      .filter(({ other }) => other.baseline !== undefined)
      .sort((a, b) => Math.abs(a.otherIndex - index) - Math.abs(b.otherIndex - index))
      .slice(0, 2);
    if (neighbours.length === 0) return;
    const shift = neighbours.reduce((sum, { other, otherIndex }) => {
      const pivot = { x: (other.left + other.right) / 2, y: other.baseline! };
      return sum + apply(transforms[otherIndex], pivot).y - pivot.y;
    }, 0) / neighbours.length;
    transforms[index] = translation(0, shift);
  });

  // 5. Even spacing between words. The first word stays put — unless this
  //    continues earlier writing, in which case the gap to that is evened too.
  const extents = words.map((word, index) => {
    const xs = word.points.flat().map((point) => apply(transforms[index], point).x);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  });
  const unit = targetXHeight ?? xHeight;
  const adjustable = (gap: number) => gap >= unit * 0.25 && gap <= unit * 3;
  const gaps = extents.slice(1).map((extent, index) => extent.left - extents[index].right);
  const earlierGaps = earlier.slice(1).map((shape, index) => shape.left - earlier[index].right);
  const pool = [...earlierGaps, ...gaps].filter(adjustable);
  if (pool.length > 0) {
    const targetGap = clamp(median(pool), unit * 0.5, unit * 1.6);
    const before = earlier.filter((shape) => shape.right <= extents[0].left + unit).at(-1);
    const lead = before ? extents[0].left - before.right : Number.NaN;
    let shift = before && adjustable(lead) ? targetGap - lead : 0;
    transforms[0] = compose(translation(shift, 0), transforms[0]);
    gaps.forEach((gap, index) => {
      if (adjustable(gap)) shift += targetGap - gap;
      transforms[index + 1] = compose(translation(shift, 0), transforms[index + 1]);
    });
  }

  // 6. Back to document coordinates, with pressure evened toward the line's typical weight.
  const typicalPressure = median(raw.flatMap((points) => points.map((point) => point.pressure)));
  const replacements = new Map<string, StrokeObject>();
  words.forEach((word, index) => {
    const toDocument = compose(outOfLine, compose(transforms[index], intoLine));
    for (const stroke of word.members) {
      const points = smoothed.get(stroke.id)!.map((point) => ({
        ...point,
        ...apply(toDocument, point),
        pressure: clamp(point.pressure * (1 - PRESSURE_EVENING) + typicalPressure * PRESSURE_EVENING, 0, 1),
      }));
      replacements.set(stroke.id, withPoints(stroke, simplify(points, spacing * 0.05)));
    }
  });
  return strokes.map((stroke) => replacements.get(stroke.id) ?? stroke);
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
 * Pen strokes already on the page that continue the same written line: they
 * share its vertical band, sit close to it horizontally, and are not a drawing
 * several times the line's height.
 */
function lineReferences(line: StrokeObject[], candidates: StrokeObject[]): StrokeObject[] {
  const bounds = inkBounds(line);
  const reach = bounds.height * 4;
  return candidates.filter((stroke) => {
    const overlap = Math.min(stroke.y + stroke.height, bounds.y + bounds.height) - Math.max(stroke.y, bounds.y);
    return overlap >= Math.min(stroke.height, bounds.height) * 0.5
      && stroke.height <= bounds.height * 2.5
      && stroke.x <= bounds.x + bounds.width + reach
      && stroke.x + stroke.width >= bounds.x - reach;
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
  const penStrokes = objects.filter((object): object is StrokeObject => object.kind === "stroke" && object.tool === "pen");
  const strokes = penStrokes.filter((stroke) => expected.get(stroke.id) === stroke.revision);
  if (strokes.length === 0) return { objects, changedIds: [] };
  const others = penStrokes.filter((stroke) => !expected.has(stroke.id));

  const replacements = new Map(
    groupStrokesIntoLines(strokes)
      .flatMap((line) => neatenLine(line, { references: lineReferences(line, others) }))
      .map((stroke) => [stroke.id, stroke]),
  );
  return {
    objects: objects.map((object) => replacements.get(object.id) ?? object),
    changedIds: [...replacements.keys()],
  };
}
