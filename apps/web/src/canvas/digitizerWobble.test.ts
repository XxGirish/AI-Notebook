import { describe, expect, it } from "vitest";
import type { PointSample } from "../domain/notebook";
import { removeDigitizerWobble } from "./digitizerWobble";
import { random, writeLine } from "./handwriting/syntheticHandwriting";

type Point = { x: number; y: number };

// A pen moving at an even pace along `path`, one sample every `spacing` px.
const sampleAlong = (path: Point[], spacing = 1.2): PointSample[] => {
  const samples: Point[] = [path[0]];
  let carried = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    let at = spacing - carried;
    for (; at <= length; at += spacing) {
      samples.push({ x: from.x + ((to.x - from.x) * at) / length, y: from.y + ((to.y - from.y) * at) / length });
    }
    carried = length - (at - spacing);
  }
  samples.push(path[path.length - 1]);
  return samples.map((point, time) => ({ ...point, pressure: 0.5, time }));
};

// A capacitive digitizer: each axis is pulled toward the nearest electrode, a
// sine error that repeats every 32 screen px, plus a little sensor noise. A
// 2.5 px pull is a bit harsher than the device the bug was reported on, whose
// diagonals swung ±3–4 px sideways every 38–47 px.
const digitize = (samples: PointSample[], phase: [number, number] = [7, 19], pull = 2.5): PointSample[] => {
  const noise = random(phase[0] * 31 + phase[1]);
  const error = (value: number, offset: number) => -pull * Math.sin((2 * Math.PI * (value + offset)) / 32);
  return samples.map((sample) => ({
    ...sample,
    x: sample.x + error(sample.x, phase[0]) + 0.3 * (noise() - 0.5),
    y: sample.y + error(sample.y, phase[1]) + 0.3 * (noise() - 0.5),
  }));
};

const PHASES: [number, number][] = [[7, 19], [0, 0], [3, 25], [12, 4]];

const lineAt = (degrees: number, length = 300): Point[] => {
  const angle = (degrees * Math.PI) / 180;
  return [{ x: 300, y: 400 }, { x: 300 + length * Math.cos(angle), y: 400 - length * Math.sin(angle) }];
};

// Sideways deviation from the true line, away from the ends: how wavy the
// drawn line looks. The mean offset is removed; a constant shift is invisible.
const waviness = (points: Point[], [from, to]: Point[], margin = 25) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const offsets = points
    .filter((point) => {
      const along = (point.x - from.x) * ux + (point.y - from.y) * uy;
      return along > margin && along < length - margin;
    })
    .map((point) => (point.y - from.y) * ux - (point.x - from.x) * uy);
  const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  return {
    max: Math.max(...offsets.map((value) => Math.abs(value - mean))),
    rms: Math.sqrt(offsets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / offsets.length),
  };
};

const largestMove = (before: Point[], after: Point[]) =>
  Math.max(...before.map((point, index) => Math.hypot(point.x - after[index].x, point.y - after[index].y)));

describe("digitizer wobble removal", () => {
  it("straightens diagonal and tilted lines that the sensor grid turned into staircases", () => {
    for (const degrees of [20, 35, 45, 60, 70]) {
      for (const phase of PHASES) {
        const line = lineAt(degrees);
        const drawn = digitize(sampleAlong(line), phase);
        const before = waviness(drawn, line);
        const after = waviness(removeDigitizerWobble(drawn), line);
        // The model reproduces the report: a visible staircase before. (At some
        // offsets of a 45° line the two axes' errors partly cancel.)
        expect(before.max).toBeGreaterThan(1.5);
        expect(after.max).toBeLessThan(1.2);
        expect(after.rms).toBeLessThan(0.3);
      }
    }
  });

  it("keeps both ends of the stroke on their samples, so the tip never trails the pen", () => {
    const drawn = digitize(sampleAlong(lineAt(40)));
    // Mid-stroke as well as finished: the live tip is always the newest sample.
    for (const stroke of [drawn.slice(0, 120), drawn]) {
      const steadied = removeDigitizerWobble(stroke);
      expect(steadied[0]).toEqual(stroke[0]);
      expect(steadied.at(-1)).toEqual(stroke.at(-1));
    }
  });

  it("leaves handwriting exactly as written", () => {
    for (const xHeight of [10, 12, 16, 20, 24]) {
      const { strokes } = writeLine(["nel", "gun", "one", "lung", "eel", "nag", "loon"], { xHeight });
      for (const stroke of strokes) {
        const samples = sampleAlong(stroke.points);
        expect(largestMove(samples, removeDigitizerWobble(samples))).toBeLessThan(0.1);
      }
    }
  });

  it("keeps corners sharp while straightening the sides", () => {
    // A zigzag, like a W or the head of an arrow, drawn in one stroke.
    const corners = [{ x: 300, y: 300 }, { x: 360, y: 440 }, { x: 420, y: 300 }, { x: 480, y: 440 }, { x: 540, y: 300 }];
    const clean = sampleAlong(corners);
    // Only the samples either side of a corner shift, and by a hair: the true
    // corner falls between two samples.
    expect(largestMove(clean, removeDigitizerWobble(clean))).toBeLessThan(0.2);

    for (const phase of PHASES) {
      const drawn = digitize(clean, phase);
      const steadied = removeDigitizerWobble(drawn);
      for (const corner of corners.slice(1, -1)) {
        // The corner is not rounded off: ink still reaches it.
        const nearest = Math.min(...steadied.map((point) => Math.hypot(point.x - corner.x, point.y - corner.y)));
        expect(nearest).toBeLessThan(3.5);
      }
      for (let side = 1; side < corners.length; side += 1) {
        const segment = [corners[side - 1], corners[side]];
        // The middle of this side, not the parallel sides beside it.
        const inside = (point: Point) => {
          const dx = segment[1].x - segment[0].x;
          const dy = segment[1].y - segment[0].y;
          const t = ((point.x - segment[0].x) * dx + (point.y - segment[0].y) * dy) / (dx * dx + dy * dy);
          const away = Math.abs((point.y - segment[0].y) * dx - (point.x - segment[0].x) * dy) / Math.hypot(dx, dy);
          return t > 0.3 && t < 0.7 && away < 10;
        };
        expect(waviness(steadied.filter(inside), segment, 0).max).toBeLessThan(waviness(drawn.filter(inside), segment, 0).max * 0.6);
      }
    }
  });

  it("smooths wobbly arcs without shrinking them", () => {
    const radius = 150;
    const arc = Array.from({ length: 400 }, (_, step) => {
      const angle = (step / 399) * ((2 * Math.PI) / 3);
      return { x: 500 + radius * Math.cos(angle), y: 500 - radius * Math.sin(angle) };
    });
    const offset = (point: Point) => Math.hypot(point.x - 500, point.y - 500) - radius;
    const radial = (points: Point[]) => {
      const offsets = points.slice(20, -20).map(offset);
      const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
      return { mean, rms: Math.sqrt(offsets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / offsets.length) };
    };

    // Samples may slide along the arc; its shape must not change.
    const clean = sampleAlong(arc);
    const steadied = removeDigitizerWobble(clean);
    expect(Math.max(...steadied.map((point) => Math.abs(offset(point))))).toBeLessThan(0.25);

    for (const phase of PHASES) {
      const drawn = digitize(clean, phase);
      const before = radial(drawn);
      const after = radial(removeDigitizerWobble(drawn));
      // Where the arc runs nearly level or upright the wobble along it is too
      // long to tell from the curve, so about half remains there.
      expect(after.rms).toBeLessThan(Math.min(0.9, before.rms * 0.6));
      expect(Math.abs(after.mean - before.mean)).toBeLessThan(0.3);
    }
  });

  it("measures the wobble in screen pixels at any zoom", () => {
    const drawn = digitize(sampleAlong(lineAt(35)));
    const atOne = removeDigitizerWobble(drawn, 1);
    // The same pen motion captured at 200% zoom: page units are half a screen pixel.
    const atTwo = removeDigitizerWobble(drawn.map((point) => ({ ...point, x: point.x / 2, y: point.y / 2 })), 2);
    atTwo.forEach((point, index) => {
      expect(point.x * 2).toBeCloseTo(atOne[index].x, 9);
      expect(point.y * 2).toBeCloseTo(atOne[index].y, 9);
    });
  });

  it("changes only positions, and leaves dots and short strokes alone", () => {
    const drawn = digitize(sampleAlong(lineAt(45)));
    const steadied = removeDigitizerWobble(drawn);
    expect(steadied).toHaveLength(drawn.length);
    steadied.forEach((point, index) => {
      expect(point.pressure).toBe(drawn[index].pressure);
      expect(point.time).toBe(drawn[index].time);
    });

    const dot = [{ x: 5, y: 5, pressure: 0.5, time: 0 }];
    expect(removeDigitizerWobble(dot)).toEqual(dot);
    const tick = digitize(sampleAlong(lineAt(45, 30)));
    expect(removeDigitizerWobble(tick)).toEqual(tick);
  });
});
