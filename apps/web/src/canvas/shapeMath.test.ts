import { describe, expect, it } from "vitest";
import { boundsFromPoints } from "./shapeMath";

describe("shape drag geometry", () => {
  it("creates bounds while dragging down and right", () => {
    expect(boundsFromPoints({ x: 10, y: 20 }, { x: 90, y: 70 })).toEqual({ x: 10, y: 20, width: 80, height: 50 });
  });

  it("normalizes a drag in the opposite direction", () => {
    expect(boundsFromPoints({ x: 90, y: 70 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 80, height: 50 });
  });
});
