import { describe, expect, it } from "vitest";
import type { GraphNodeObject, StrokeObject } from "../domain/notebook";
import { objectIntersectsPolygon, pointInPolygon, topmostBoxAt } from "./selectionMath";

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

describe("hit-testing boxes", () => {
  const boxes = [
    { id: "below", x: 0, y: 0, width: 100, height: 100 },
    { id: "above", x: 50, y: 50, width: 100, height: 100 },
  ];

  it("returns the box drawn last where boxes overlap, and nothing on empty canvas", () => {
    expect(topmostBoxAt(boxes, { x: 75, y: 75 })?.id).toBe("above");
    expect(topmostBoxAt(boxes, { x: 10, y: 10 })?.id).toBe("below");
    expect(topmostBoxAt(boxes, { x: 400, y: 400 })).toBeUndefined();
  });

  it("allows slack around a box for an imprecise finger", () => {
    expect(topmostBoxAt(boxes, { x: -6, y: 10 })).toBeUndefined();
    expect(topmostBoxAt(boxes, { x: -6, y: 10 }, 8)?.id).toBe("below");
  });
});
