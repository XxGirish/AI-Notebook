import { describe, expect, it } from "vitest";
import type { NotebookObject, PointSample, StrokeObject } from "../../domain/notebook";
import { neatenHandwriting, neatenLine, writingAngle } from "./neatenInk";

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

const allPoints = (strokes: StrokeObject[]) => strokes.flatMap((item) => item.points);

describe("neatening a line of handwriting", () => {
  it("smooths tremor along a curve while keeping its endpoints", () => {
    // A 40-unit arc drawn with a fine, fast wobble, like an unsteady hand.
    const radius = 40;
    const clean = (angle: number) => [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)] as const;
    const samples = Array.from({ length: 51 }, (_, index) => {
      const angle = Math.PI + (Math.PI * index) / 50;
      const [x, y] = clean(angle);
      const jitter = index % 2 === 0 ? 1.5 : -1.5;
      return [x + jitter * Math.cos(angle), y + jitter * Math.sin(angle)] as [number, number];
    });
    const shaky = stroke("shaky", samples);
    const [neat] = neatenLine([shaky]);
    const wobble = (points: PointSample[]) => Math.max(...points.slice(8, -8).map((point) => Math.abs(Math.hypot(point.x - 100, point.y - 100) - radius)));

    expect(wobble(neat.points)).toBeLessThan(wobble(shaky.points) / 3);
    expect(neat.points[0]).toMatchObject({ x: shaky.points[0].x, y: shaky.points[0].y });
    expect(neat.points.at(-1)).toMatchObject({ x: shaky.points.at(-1)!.x, y: shaky.points.at(-1)!.y });
    expect(neat.revision).toBe(2);
  });

  it("levels a word written uphill without changing letter sizes", () => {
    const tilt = (-10 * Math.PI) / 180;
    const upright = [
      stroke("h", [[0, 0], [0, 40], [0, 20], [20, 20], [20, 40]]),
      stroke("e", [[40, 30], [60, 30], [55, 20], [45, 20], [40, 30], [45, 40], [60, 40]]),
      stroke("l", [[80, 0], [80, 40]]),
      stroke("o", [[100, 30], [110, 20], [120, 30], [110, 40], [100, 30]]),
    ];
    const uphill = upright.map((item) => stroke(item.id, item.points.map((point) => [
      point.x * Math.cos(tilt) - point.y * Math.sin(tilt),
      point.x * Math.sin(tilt) + point.y * Math.cos(tilt),
    ])));

    const neat = neatenLine(uphill);
    expect(Math.abs(writingAngle(allPoints(neat)))).toBeLessThan((1 * Math.PI) / 180);
    const tall = (item: StrokeObject) => item.height;
    expect(tall(neat[2])).toBeCloseTo(tall(upright[2]), 0);
  });

  it("keeps steep lines, short single letters and dots at their original angle", () => {
    const steep = stroke("steep", [[0, 0], [30, 30], [60, 60], [90, 90]]);
    expect(neatenLine([steep])[0].points.at(-1)).toMatchObject({ x: 90, y: 90 });

    const dot = stroke("dot", [[5, 5], [5.5, 5.2]]);
    expect(neatenLine([dot])[0].points.map(({ x, y }) => [x, y])).toEqual([[5, 5], [5.5, 5.2]]);
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
