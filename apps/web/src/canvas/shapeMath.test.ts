import { describe, expect, it } from "vitest";
import { boundsFromPoints, sizeFromBottomRightHandle } from "./shapeMath";

describe("shape drag geometry", () => {
  it("creates bounds while dragging down and right", () => {
    expect(boundsFromPoints({ x: 10, y: 20 }, { x: 90, y: 70 })).toEqual({ x: 10, y: 20, width: 80, height: 50 });
  });

  it("normalizes a drag in the opposite direction", () => {
    expect(boundsFromPoints({ x: 90, y: 70 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 80, height: 50 });
  });
});

describe("resize handle geometry", () => {
  it("uses the handle position as the next size without changing an origin", () => {
    expect(sizeFromBottomRightHandle({ x: 320, y: 180 }, { width: 60, height: 60 })).toEqual({ width: 320, height: 180 });
  });

  it("clamps both axes to the object's minimum size", () => {
    expect(sizeFromBottomRightHandle({ x: 12, y: -8 }, { width: 60, height: 48 })).toEqual({ width: 60, height: 48 });
  });
});
