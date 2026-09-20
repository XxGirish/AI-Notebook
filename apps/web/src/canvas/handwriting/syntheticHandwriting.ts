import type { PointSample, StrokeObject } from "../../domain/notebook";

/**
 * Test support: synthetic cursive with known, controlled messiness, and a
 * scorer that measures neatness against the clean templates rather than with
 * the neatener's own estimators (which would make the tests circular).
 */

type Point = { x: number; y: number };

// Letters in x-height units, y up from the baseline, each as a function of s ∈ [0, 1].
const LETTERS: Record<string, { width: number; path: (s: number) => Point }> = {
  // Loop to the midline, like a cursive e.
  e: { width: 0.55, path: (s) => ({ x: 0.55 * s - 0.25 * Math.sin(2 * Math.PI * s), y: 0.5 * (1 - Math.cos(2 * Math.PI * s)) }) },
  // Tall loop, an ascender.
  l: { width: 0.55, path: (s) => ({ x: 0.55 * s - 0.3 * Math.sin(2 * Math.PI * s), y: 1 - Math.cos(2 * Math.PI * s) }) },
  // Two arches, like m/n humps.
  n: { width: 0.9, path: (s) => ({ x: 0.9 * s, y: Math.abs(Math.sin(2 * Math.PI * s)) }) },
  // Garland: down to the baseline and back up, then down again, like u.
  u: {
    width: 0.8,
    path: (s) => s < 0.75
      ? { x: 0.6 * (s / 0.75), y: 1 - Math.sin((Math.PI * s) / 0.75) }
      : { x: 0.6 + 0.2 * ((s - 0.75) / 0.25), y: 1 - (s - 0.75) / 0.25 },
  },
  // Counter-clockwise bowl from the top, then out along the baseline, like o/a.
  o: {
    width: 0.75,
    path: (s) => s < 0.8
      ? { x: 0.3 + 0.3 * Math.cos(Math.PI / 2 + (2 * Math.PI * s) / 0.8), y: 0.5 + 0.5 * Math.sin(Math.PI / 2 + (2 * Math.PI * s) / 0.8) }
      : { x: 0.3 + 0.45 * ((s - 0.8) / 0.2), y: 1 - 0.6 * ((s - 0.8) / 0.2) },
  },
  // Bowl and a stem down to the baseline, like a.
  a: {
    width: 0.75,
    path: (s) => s < 0.7
      ? { x: 0.3 + 0.3 * Math.cos(Math.PI / 2 + (2 * Math.PI * s) / 0.7), y: 0.5 + 0.5 * Math.sin(Math.PI / 2 + (2 * Math.PI * s) / 0.7) }
      : { x: 0.6 + 0.15 * ((s - 0.7) / 0.3), y: 1 - (s - 0.7) / 0.3 },
  },
  // Bowl with a descender loop, like g.
  g: {
    width: 0.8,
    path: (s) => {
      if (s < 0.5) return { x: 0.3 + 0.3 * Math.cos(Math.PI / 2 + (2 * Math.PI * s) / 0.5), y: 0.5 + 0.5 * Math.sin(Math.PI / 2 + (2 * Math.PI * s) / 0.5) };
      if (s < 0.75) return { x: 0.6, y: 1 - 1.8 * ((s - 0.5) / 0.25) };
      const t = (s - 0.75) / 0.25;
      return { x: 0.6 - 0.35 * Math.sin(Math.PI * t) + 0.2 * t, y: -0.8 + 0.8 * t };
    },
  },
};

/** A clean cursive word as one continuous stroke, in x-height units (y up). */
export function wordTemplate(text: string): Point[] {
  const points: Point[] = [];
  let advance = 0;
  for (const letter of text) {
    const shape = LETTERS[letter];
    if (!shape) throw new Error(`no template for ${letter}`);
    for (let step = 0; step <= 60; step += 1) {
      const point = shape.path(step / 60);
      points.push({ x: advance + point.x, y: point.y });
    }
    advance += shape.width + 0.15;
  }
  return points;
}

/** Deterministic pseudo-random numbers so fixtures are identical on every run. */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export type WordMess = {
  /** Vertical drift off the line, in x-heights (positive = lower). */
  drop: number;
  scale: number;
  /** Extra lean, as horizontal travel per unit height. */
  slant: number;
  /** Word's own tilt in radians. */
  tilt: number;
  /** Gap before the word, in x-heights. */
  gap: number;
};

export type SyntheticLine = {
  strokes: StrokeObject[];
  /** Clean template of each stroke, in x-height units, by stroke id. */
  templates: Map<string, Point[]>;
  xHeight: number;
};

/**
 * Writes `words` as a line of cursive at `xHeight` document units, applying
 * each word's mess, a tilt to the whole line, and hand tremor.
 */
export function writeLine(words: string[], options: {
  xHeight: number;
  origin?: Point;
  baseSlant?: number;
  lineTilt?: number;
  mess?: WordMess[];
  tremor?: number;
  seed?: number;
  idPrefix?: string;
}): SyntheticLine {
  const { xHeight, origin = { x: 100, y: 200 }, baseSlant = 0.2, lineTilt = 0, tremor = 0, seed = 1, idPrefix = "w" } = options;
  const next = random(seed);
  const strokes: StrokeObject[] = [];
  const templates = new Map<string, Point[]>();
  let cursor = 0;
  words.forEach((text, index) => {
    const mess = options.mess?.[index] ?? { drop: 0, scale: 1, slant: 0, tilt: 0, gap: 1 };
    const template = wordTemplate(text);
    const width = Math.max(...template.map((point) => point.x));
    if (index > 0) cursor += mess.gap * xHeight;
    const size = xHeight * mess.scale;
    const slant = baseSlant + mess.slant;
    const phase = next() * 100;
    const points = template.map((point, step): PointSample => {
      // Word frame: slant, then the word's own tilt about its baseline start.
      const sx = (point.x + point.y * slant) * size;
      const sy = -point.y * size;
      const wx = sx * Math.cos(mess.tilt) - sy * Math.sin(mess.tilt);
      const wy = sx * Math.sin(mess.tilt) + sy * Math.cos(mess.tilt);
      // Tremor: a fast wobble plus small jitter, both a fraction of the x-height.
      const wobble = tremor * xHeight * Math.sin(phase + step * 1.9);
      const jitter = tremor * 0.4 * xHeight * (next() - 0.5);
      const lx = cursor + wx + jitter;
      const ly = wy + mess.drop * xHeight + wobble;
      return {
        x: origin.x + lx * Math.cos(lineTilt) - ly * Math.sin(lineTilt),
        y: origin.y + lx * Math.sin(lineTilt) + ly * Math.cos(lineTilt),
        pressure: 0.5,
        time: step * 4,
      };
    });
    cursor += width * size;
    const id = `${idPrefix}${index}`;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    strokes.push({
      id, revision: 1, kind: "stroke", tool: "pen", color: "#183153", size: 3,
      x: Math.min(...xs) - 1.5, y: Math.min(...ys) - 1.5,
      width: Math.max(...xs) - Math.min(...xs) + 3, height: Math.max(...ys) - Math.min(...ys) + 3,
      points,
    });
    templates.set(id, template);
  });
  return { strokes, templates, xHeight };
}

/** `count` evenly spaced points by arc length. */
function byArcLength(points: Point[], count: number): Point[] {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = lengths[lengths.length - 1];
  const result: Point[] = [];
  let segment = 1;
  for (let step = 0; step < count; step += 1) {
    const target = (total * step) / (count - 1);
    while (segment < lengths.length - 1 && lengths[segment] < target) segment += 1;
    const span = lengths[segment] - lengths[segment - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - lengths[segment - 1]) / span));
    result.push({
      x: points[segment - 1].x + (points[segment].x - points[segment - 1].x) * t,
      y: points[segment - 1].y + (points[segment].y - points[segment - 1].y) * t,
    });
  }
  return result;
}

/** Least-squares affine map from template (y up) to ink: ink ≈ A·t + c. */
function fitAffine(template: Point[], ink: Point[]) {
  // Normal equations for [a c e] and [b d f] against rows [tx, ty, 1].
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = 0;
  let ux = 0, uy = 0, u = 0, vx = 0, vy = 0, v = 0;
  template.forEach((t, index) => {
    const p = ink[index];
    sxx += t.x * t.x; sxy += t.x * t.y; syy += t.y * t.y; sx += t.x; sy += t.y; n += 1;
    ux += t.x * p.x; uy += t.y * p.x; u += p.x;
    vx += t.x * p.y; vy += t.y * p.y; v += p.y;
  });
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const solve = (rhs: number[]) => {
    const a = m.map((row, index) => [...row, rhs[index]]);
    for (let col = 0; col < 3; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < 3; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      for (let row = 0; row < 3; row += 1) {
        if (row === col) continue;
        const factor = a[row][col] / a[col][col];
        for (let k = col; k < 4; k += 1) a[row][k] -= factor * a[col][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  };
  const [a, c, e] = solve([ux, uy, u]);
  const [b, d, f] = solve([vx, vy, v]);
  const map = (t: Point) => ({ x: a * t.x + c * t.y + e, y: b * t.x + d * t.y + f });
  const residual = Math.sqrt(template.reduce((sum, t, index) => sum + (map(t).x - ink[index].x) ** 2 + (map(t).y - ink[index].y) ** 2, 0) / template.length);
  return { a, b, c, d, e, f, map, residual };
}

const deviation = (values: number[]) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
};

export type Neatness = {
  /** Scatter of word baselines about their best straight line, in x-heights. */
  baselineWave: number;
  /** Angle of that line, degrees. */
  lineTiltDegrees: number;
  /** Scatter of word rotations, degrees. */
  wordTiltDegrees: number;
  /** Coefficient of variation of word size. */
  sizeVariation: number;
  /** Scatter of word slant, degrees. */
  slantDegrees: number;
  /** Coefficient of variation of the gaps between words. */
  gapVariation: number;
  /** Ink the best affine map of the clean template cannot explain (tremor, distortion), in x-heights. */
  shapeError: number;
};

/** Scores a line of cursive against the clean templates it was written from. */
export function measureNeatness(strokes: StrokeObject[], templates: Map<string, Point[]>): Neatness {
  const words = strokes.map((stroke) => {
    const template = byArcLength(templates.get(stroke.id)!, 200);
    const ink = byArcLength(stroke.points, 200);
    const fit = fitAffine(template, ink);
    const scale = Math.sqrt(Math.abs(fit.a * fit.d - fit.b * fit.c));
    const rotation = Math.atan2(fit.b, fit.a);
    // The template's upward direction (0, 1) in ink, seen from the word's own baseline direction.
    const upX = fit.c, upY = fit.d;
    const cos = Math.cos(-rotation), sin = Math.sin(-rotation);
    const slant = Math.atan2(upX * cos - upY * sin, -(upX * sin + upY * cos));
    const width = Math.max(...templates.get(stroke.id)!.map((point) => point.x));
    const base = fit.map({ x: width / 2, y: 0 });
    const xs = stroke.points.map((point) => point.x);
    return { scale, rotation, slant, base, left: Math.min(...xs), right: Math.max(...xs), residual: fit.residual };
  }).sort((a, b) => a.left - b.left);

  const meanScale = words.reduce((sum, word) => sum + word.scale, 0) / words.length;
  const n = words.length;
  const mx = words.reduce((sum, word) => sum + word.base.x, 0) / n;
  const my = words.reduce((sum, word) => sum + word.base.y, 0) / n;
  const slope = words.reduce((sum, word) => sum + (word.base.x - mx) * (word.base.y - my), 0)
    / Math.max(1e-9, words.reduce((sum, word) => sum + (word.base.x - mx) ** 2, 0));
  const wave = deviation(words.map((word) => word.base.y - (my + slope * (word.base.x - mx))));
  const gaps = words.slice(1).map((word, index) => word.left - words[index].right);
  const gapMean = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  return {
    baselineWave: wave / meanScale,
    lineTiltDegrees: Math.abs(degrees(Math.atan(slope))),
    wordTiltDegrees: degrees(deviation(words.map((word) => word.rotation))),
    sizeVariation: deviation(words.map((word) => word.scale)) / meanScale,
    slantDegrees: degrees(deviation(words.map((word) => word.slant))),
    gapVariation: gaps.length > 1 ? deviation(gaps) / gapMean : 0,
    shapeError: words.reduce((sum, word) => sum + word.residual, 0) / n / meanScale,
  };
}

/** A realistic untidy line: every kind of inconsistency at once. */
export function messyLine(seed: number, xHeight = 12): SyntheticLine {
  const next = random(seed);
  const words = ["nel", "gun", "one", "lung", "eel", "nag", "loon"];
  const spread = (amount: number) => (next() - 0.5) * 2 * amount;
  return writeLine(words, {
    xHeight,
    seed,
    lineTilt: (4 * Math.PI) / 180,
    tremor: 0.03,
    mess: words.map(() => ({
      drop: spread(0.3),
      scale: 1 + spread(0.18),
      slant: spread(0.15),
      tilt: spread((4 * Math.PI) / 180),
      gap: 0.8 + next() * 1.1,
    })),
  });
}
