import { describe, expect, it } from "vitest";
import type { GraphNodeObject, StrokeObject } from "../domain/notebook";
import { objectIntersectsPolygon, pointInPolygon } from "./selectionMath";

const polygon = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe("whole-object lasso geometry", () => {
  it("detects points inside and outside", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, polygon)).toBe(false);
  });

  it("selects a complete stroke when one stored sample is inside", () => {
    const stroke: StrokeObject = {
      id: "s",
      revision: 1,
      kind: "stroke",
      tool: "pen",
      color: "#000",
      size: 4,
      x: -20,
      y: 50,
      width: 140,
      height: 0,
      points: [
        { x: -20, y: 50, pressure: 0.5, time: 0 },
        { x: 50, y: 50, pressure: 0.5, time: 1 },
        { x: 120, y: 50, pressure: 0.5, time: 2 },
      ],
    };
    expect(objectIntersectsPolygon(stroke, polygon)).toBe(true);
  });

  it("selects an object that contains the lasso", () => {
    const node: GraphNodeObject = {
      id: "node",
      revision: 1,
      kind: "graph-node",
      label: "Node",
      x: -20,
      y: -20,
      width: 140,
      height: 140,
    };
    expect(objectIntersectsPolygon(node, polygon)).toBe(true);
  });
});
