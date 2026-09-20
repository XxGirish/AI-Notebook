import { describe, expect, it } from "vitest";
import type { NotebookObject, PointSample, StrokeObject } from "../../domain/notebook";
import { neatenHandwriting, neatenLine } from "./neatenInk";
import { measureNeatness, messyLine, writeLine } from "./syntheticHandwriting";

const stroke = (id: string, points: Array<[number, number, number?]>, tool: StrokeObject["tool"] = "pen"): StrokeObject => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    id,
    revision: 1,
    kind: "stroke",
    tool,
    color: "#183153",
    size: 4,
    x: Math.min(...xs) - 2,
    y: Math.min(...ys) - 2,
    width: Math.max(...xs) - Math.min(...xs) + 4,
    height: Math.max(...ys) - Math.min(...ys) + 4,
    points: points.map(([x, y, pressure = 0.5], time): PointSample => ({ x, y, pressure, time })),
  };
};

const average = (seeds: number[], score: (seed: number) => number) => seeds.reduce((sum, seed) => sum + score(seed), 0) / seeds.length;
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

// Every messy line has a tilted line, words drifting ±0.3 x-heights off it,
// ±18% size, ±8° slant, ±4° word tilt, gaps of 0.8–1.9 x-heights and tremor.
// Neatness is scored against the clean templates the words were written from.
describe("neatening a messy line of cursive", () => {
  const before = (seed: number) => { const line = messyLine(seed); return measureNeatness(line.strokes, line.templates); };
  const after = (seed: number) => { const line = messyLine(seed); return measureNeatness(neatenLine(line.strokes), line.templates); };

  it("puts every word on one level baseline", () => {
    expect(average(seeds, (seed) => before(seed).baselineWave)).toBeGreaterThan(0.1);
    expect(average(seeds, (seed) => after(seed).baselineWave)).toBeLessThan(0.02);
    expect(average(seeds, (seed) => after(seed).lineTiltDegrees)).toBeLessThan(0.3);
  });

  it("straightens words that tilt on their own", () => {
    expect(average(seeds, (seed) => after(seed).wordTiltDegrees)).toBeLessThan(average(seeds, (seed) => before(seed).wordTiltDegrees) * 0.5);
  });

  it("evens out word size", () => {
    expect(average(seeds, (seed) => after(seed).sizeVariation)).toBeLessThan(average(seeds, (seed) => before(seed).sizeVariation) * 0.4);
  });

  it("makes the slant of the words consistent", () => {
    expect(average(seeds, (seed) => after(seed).slantDegrees)).toBeLessThan(average(seeds, (seed) => before(seed).slantDegrees) * 0.7);
  });

  it("evens out the spacing between words", () => {
    expect(average(seeds, (seed) => after(seed).gapVariation)).toBeLessThan(0.08);
  });

  it("removes tremor without distorting the letters", () => {
    // Shape error is whatever an affine map of the clean word cannot explain:
    // tremor raises it, and so would any change to the letterforms themselves.
    expect(average(seeds, (seed) => after(seed).shapeError)).toBeLessThan(average(seeds, (seed) => before(seed).shapeError) * 0.7);
  });

  it("behaves the same at any writing size", () => {
    const small = messyLine(3, 5);
    const large = messyLine(3, 30);
    const smallScore = measureNeatness(neatenLine(small.strokes), small.templates);
    const largeScore = measureNeatness(neatenLine(large.strokes), large.templates);
    for (const key of Object.keys(smallScore) as Array<keyof typeof smallScore>) {
      expect(smallScore[key]).toBeCloseTo(largeScore[key], 3);
    }
  });
});

describe("what neatening leaves alone", () => {
  it("leaves already neat writing essentially as it was", () => {
    const neat = writeLine(["nel", "gun", "one", "lung"], { xHeight: 12 });
    const score = measureNeatness(neatenLine(neat.strokes), neat.templates);
    expect(score.baselineWave).toBeLessThan(0.01);
    expect(score.wordTiltDegrees).toBeLessThan(0.5);
    expect(score.slantDegrees).toBeLessThan(1.5);
    expect(score.sizeVariation).toBeLessThan(0.01);
    expect(score.shapeError).toBeLessThan(0.05);
  });

  it("keeps a deliberately steep line at its own angle", () => {
    const steep = writeLine(["nel", "gun", "one"], { xHeight: 12, lineTilt: (35 * Math.PI) / 180 });
    expect(measureNeatness(neatenLine(steep.strokes), steep.templates).lineTiltDegrees).toBeCloseTo(35, 0);
  });

  it("carries dots and short marks along with their word", () => {
    const line = writeLine(["nel", "gun"], { xHeight: 12, mess: [
      { drop: 0, scale: 1, slant: 0, tilt: 0, gap: 1 },
      { drop: 0.4, scale: 1, slant: 0, tilt: 0, gap: 1 },
    ] });
    const gun = line.strokes[1];
    // A dot written just above the drifting second word.
    const top = Math.min(...gun.points.map((point) => point.y));
    const dotX = gun.x + gun.width / 2;
    const dot = stroke("dot", [[dotX, top - 8], [dotX + 0.6, top - 7.8]]);
    const [neatNel, neatGun, neatDot] = neatenLine([...line.strokes, dot]);
    const neatTop = Math.min(...neatGun.points.map((point) => point.y));
    expect(neatDot.points[0].y - neatTop).toBeCloseTo(dot.points[0].y - top, 0);
    // The words themselves were brought onto one baseline.
    expect(measureNeatness([neatNel, neatGun], line.templates).baselineWave).toBeLessThan(0.02);
  });

  it("keeps tiny marks and dots at their shape", () => {
    const dot = stroke("dot", [[5, 5], [5.5, 5.2]]);
    expect(neatenLine([dot])[0].points.map(({ x, y }) => [x, y])).toEqual([[5, 5], [5.5, 5.2]]);
  });

  it("smooths tremor along a curve while keeping its endpoints", () => {
    // A 40-unit arc drawn with a fine, fast wobble, like an unsteady hand.
    const radius = 40;
    const samples = Array.from({ length: 51 }, (_, index) => {
      const angle = Math.PI + (Math.PI * index) / 50;
      const jitter = index % 2 === 0 ? 1.5 : -1.5;
      return [100 + (radius + jitter) * Math.cos(angle), 100 + (radius + jitter) * Math.sin(angle)] as [number, number];
    });
    const shaky = stroke("shaky", samples);
    const [neat] = neatenLine([shaky]);
    const wobble = (points: PointSample[]) => Math.max(...points.slice(8, -8).map((point) => Math.abs(Math.hypot(point.x - 100, point.y - 100) - radius)));
    expect(wobble(neat.points)).toBeLessThan(wobble(shaky.points) / 3);
    expect(neat.points[0]).toMatchObject({ x: shaky.points[0].x, y: shaky.points[0].y });
    expect(neat.points.at(-1)).toMatchObject({ x: shaky.points.at(-1)!.x, y: shaky.points.at(-1)!.y });
    expect(neat.revision).toBe(2);
  });

  it("evens out blotchy pressure toward the line's typical weight", () => {
    const blotchy = stroke("blotchy", Array.from({ length: 30 }, (_, index) => [index * 4, 10, index === 15 ? 1 : 0.4]));
    const [neat] = neatenLine([blotchy]);
    const pressures = neat.points.map((point) => point.pressure);
    expect(Math.max(...pressures)).toBeLessThan(0.6);
    expect(Math.min(...pressures)).toBeGreaterThan(0.35);
  });
});

describe("applying neatening to the document", () => {
  it("lines a new burst of writing up with the words already on the line", () => {
    const first = writeLine(["nel", "gun", "one"], { xHeight: 12, idPrefix: "a" });
    const firstRight = Math.max(...first.strokes.map((item) => item.x + item.width));
    // Written after a pause: lower, larger, and a little far from the first words.
    const second = writeLine(["lung", "eel"], {
      xHeight: 12, idPrefix: "b", origin: { x: firstRight + 25, y: 200 + 12 * 0.35 },
      mess: [{ drop: 0, scale: 1.25, slant: 0, tilt: 0, gap: 1 }, { drop: 0, scale: 1.25, slant: 0, tilt: 0, gap: 1 }],
    });
    const objects: NotebookObject[] = [...first.strokes, ...second.strokes];
    const result = neatenHandwriting(objects, second.strokes.map(({ id, revision }) => ({ id, revision })));

    expect(result.changedIds.sort()).toEqual(["b0", "b1"]);
    const all = result.objects as StrokeObject[];
    const templates = new Map([...first.templates, ...second.templates]);
    const score = measureNeatness(all, templates);
    expect(score.baselineWave).toBeLessThan(0.02);
    expect(score.sizeVariation).toBeLessThan(0.04);
    // The earlier words are the reference and are not moved.
    expect(all.slice(0, 3)).toEqual(first.strokes);
  });

  it("updates only unchanged pen strokes, keeping ids and every other object", () => {
    const pen = stroke("pen", Array.from({ length: 20 }, (_, index) => [index * 6, 20 + (index % 2) * 4]));
    const moved = { ...stroke("moved", [[0, 100], [50, 104], [100, 100]]), revision: 3 };
    const highlight = stroke("highlight", [[0, 200], [50, 204], [100, 200]], "highlighter");
    const note: NotebookObject = { id: "note", revision: 1, kind: "graph-node", x: 0, y: 0, width: 10, height: 10, label: "Note" };
    const objects: NotebookObject[] = [note, pen, moved, highlight];

    const result = neatenHandwriting(objects, [
      { id: "pen", revision: 1 },
      { id: "moved", revision: 1 },
      { id: "highlight", revision: 1 },
      { id: "erased", revision: 1 },
    ]);

    expect(result.changedIds).toEqual(["pen"]);
    expect(result.objects.map((object) => object.id)).toEqual(["note", "pen", "moved", "highlight"]);
    expect(result.objects[0]).toBe(note);
    expect(result.objects[2]).toBe(moved);
    expect(result.objects[3]).toBe(highlight);
    const neat = result.objects[1] as StrokeObject;
    for (const point of neat.points) {
      expect(point.x).toBeGreaterThanOrEqual(neat.x);
      expect(point.y).toBeLessThanOrEqual(neat.y + neat.height);
    }
  });

  it("returns the same document when nothing can be neatened", () => {
    const objects: NotebookObject[] = [stroke("a", [[0, 0], [10, 10]])];
    expect(neatenHandwriting(objects, [{ id: "a", revision: 9 }])).toEqual({ objects, changedIds: [] });
  });
});
