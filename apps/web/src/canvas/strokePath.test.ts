import { describe, expect, it } from "vitest";
import type { PointSample } from "../domain/notebook";
import { getStrokeOutline, interpolateSamples } from "./strokePath";

type Point = { x: number; y: number };

// Small cursive "eeee": a prolate trochoid whose loops are about 10 units tall,
// i.e. roughly two stroke widths — the size where rendering loses the loops.
const loops = (count: number, xHeight: number): Point[] => {
  const points: Point[] = [];
  for (let angle = 0; angle <= Math.PI * 2 * count; angle += 0.01) {
    points.push({ x: (xHeight * 0.8 * angle) / (Math.PI * 2) - xHeight * 0.45 * Math.sin(angle), y: -xHeight * 0.5 * (1 - Math.cos(angle)) });
  }
  return points;
};

// Keeps every `step`-th point, like a digitizer sampling a continuous motion.
const sampleEvery = (path: Point[], step: number): PointSample[] =>
  path.filter((_, index) => index % step === 0 || index === path.length - 1).map((point, time) => ({ ...point, pressure: 0.5, time }));

// Flattens the rendered outline the way the canvas fills it: a quadratic curve
// through the midpoints of consecutive outline points, non-zero winding.
const filledArea = (outline: number[][]) => {
  const polygon: number[][] = [];
  let current = outline[0];
  for (let index = 1; index < outline.length; index += 1) {
    const control = outline[index];
    const next = outline[(index + 1) % outline.length];
    const end = [(control[0] + next[0]) / 2, (control[1] + next[1]) / 2];
    for (let step = 1; step <= 6; step += 1) {
      const u = step / 6;
      polygon.push([
        (1 - u) ** 2 * current[0] + 2 * (1 - u) * u * control[0] + u * u * end[0],
        (1 - u) ** 2 * current[1] + 2 * (1 - u) * u * control[1] + u * u * end[1],
      ]);
    }
    current = end;
  }
  return (point: Point) => {
    let winding = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const [x1, y1] = polygon[index];
      const [x2, y2] = polygon[(index + 1) % polygon.length];
      const side = (x2 - x1) * (point.y - y1) - (point.x - x1) * (y2 - y1);
      if (y1 <= point.y) {
        if (y2 > point.y && side > 0) winding += 1;
      } else if (y2 <= point.y && side < 0) winding -= 1;
    }
    return winding !== 0;
  };
};

// Share of the ideal ink body that is actually drawn: points of the true path
// and points either side of it at 70% of the stroke radius, where shrunken or
// flattened loops show up first.
const inkedShare = (path: Point[], samples: PointSample[], size: number) => {
  const inked = filledArea(getStrokeOutline(samples, size));
  const body: Point[] = [];
  for (let index = 1; index < path.length - 1; index += 1) {
    const dx = path[index + 1].x - path[index - 1].x;
    const dy = path[index + 1].y - path[index - 1].y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = size * 0.35;
    body.push(path[index]);
    body.push({ x: path[index].x - (dy / length) * offset, y: path[index].y + (dx / length) * offset });
    body.push({ x: path[index].x + (dy / length) * offset, y: path[index].y - (dx / length) * offset });
  }
  return body.filter(inked).length / body.length;
};

describe("stroke rendering fidelity", () => {
  it("keeps every part of small cursive loops under ink when samples are dense (pen)", () => {
    const path = loops(4, 10);
    // ~130 samples over the word: a 240 Hz stylus at normal writing speed.
    expect(inkedShare(path, sampleEvery(path, 20), 4.5)).toBeGreaterThan(0.99);
  });

  it("follows the curve between sparse samples instead of cutting chords (60 Hz touch)", () => {
    const path = loops(4, 10);
    // ~35 samples: a 60 Hz touch screen, samples about 6 units apart.
    expect(inkedShare(path, sampleEvery(path, 75), 4.5)).toBeGreaterThan(0.98);
  });

  it("ends the live stroke at the newest sample instead of trailing behind the pen", () => {
    // Mid-stroke on a fast straight line, samples 4 units apart: an averaging
    // filter leaves the drawn tip more than a stroke radius behind the pen.
    const samples = Array.from({ length: 12 }, (_, index) => ({ x: index * 4, y: 0, pressure: 0.5, time: index }));
    const outline = getStrokeOutline(samples, 4.5);
    const tip = samples.at(-1)!;
    expect(filledArea(outline)(tip)).toBe(true);
    expect(Math.max(...outline.map(([x]) => x))).toBeGreaterThanOrEqual(tip.x + 4.5 / 2 - 0.05);
  });

  it("draws the very start of a stroke instead of skipping its first stroke-width", () => {
    // A tiny entry hook: the first 4 units curl back before the stroke runs right.
    const hook = [{ x: 0, y: 0 }, { x: -1.5, y: -1.5 }, { x: -1.5, y: -3 }, { x: 0, y: -3.5 }, { x: 3, y: -3 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
      .map((point, time) => ({ ...point, pressure: 0.5, time }));
    const inked = filledArea(getStrokeOutline(hook, 2));
    expect(inked({ x: -1.5, y: -2.2 })).toBe(true);
  });

  it("renders a single tap as a dot so i-dots and full stops survive", () => {
    const outline = getStrokeOutline([{ x: 5, y: 5, pressure: 0.5 }], 4);
    expect(outline.length).toBeGreaterThan(3);
    expect(filledArea(outline)({ x: 5, y: 5 })).toBe(true);
  });

  it("interpolates through, not around, the original samples", () => {
    const samples = sampleEvery(loops(1, 10), 60);
    const dense = interpolateSamples(samples, 0.5);
    for (const sample of samples) {
      expect(dense.some((point) => point.x === sample.x && point.y === sample.y)).toBe(true);
    }
    for (let index = 1; index < dense.length; index += 1) {
      // Steps are even in the curve parameter, so a bend may stretch one slightly.
      expect(Math.hypot(dense[index].x - dense[index - 1].x, dense[index].y - dense[index - 1].y)).toBeLessThanOrEqual(0.6);
    }
  });
});
