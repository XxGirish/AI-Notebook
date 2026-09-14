import { describe, expect, it } from "vitest";
import type { StrokeObject } from "../domain/notebook";
import { appendDistinctPoints, strokeIntersectsPoint } from "./strokeMath";

const stroke: StrokeObject = {
  id: "stroke",
  revision: 1,
  kind: "stroke",
  tool: "pen",
  color: "#000",
  size: 4,
  x: 0,
  y: 0,
  width: 100,
  height: 0,
  points: [
    { x: 0, y: 0, pressure: 0.5, time: 0 },
    { x: 100, y: 0, pressure: 0.5, time: 10 },
  ],
};

describe("stroke geometry", () => {
  it("filters samples that are too close together", () => {
    const result = appendDistinctPoints(stroke.points.slice(0, 1), [
      { x: 0.1, y: 0.1, pressure: 0.5, time: 1 },
      { x: 2, y: 0, pressure: 0.5, time: 2 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].x).toBe(2);
  });

  it("detects whole-stroke eraser hits without pixel compositing", () => {
    expect(strokeIntersectsPoint(stroke, { x: 50, y: 3, pressure: 0.5, time: 0 }, 3)).toBe(true);
    expect(strokeIntersectsPoint(stroke, { x: 50, y: 20, pressure: 0.5, time: 0 }, 3)).toBe(false);
  });
});

