import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, wheelDeltaInPixels, wheelZoomScale, zoomCameraAt } from "./cameraMath";

describe("canvas camera", () => {
  it("keeps the world point under the pointer fixed while zooming", () => {
    const camera = { x: 20, y: 40, scale: 1 };
    const anchor = { x: 220, y: 140 };
    const zoomed = zoomCameraAt(camera, 2, anchor);

    expect(zoomed).toEqual({ x: -180, y: -60, scale: 2 });
    expect((anchor.x - zoomed.x) / zoomed.scale).toBe((anchor.x - camera.x) / camera.scale);
    expect((anchor.y - zoomed.y) / zoomed.scale).toBe((anchor.y - camera.y) / camera.scale);
  });

  it("clamps wheel zoom to the supported canvas range", () => {
    expect(zoomCameraAt({ x: 0, y: 0, scale: 1 }, 100, { x: 0, y: 0 }).scale).toBe(MAX_ZOOM);
    expect(zoomCameraAt({ x: 0, y: 0, scale: 1 }, 0.001, { x: 0, y: 0 }).scale).toBe(MIN_ZOOM);
  });

  it("maps wheel-up to zoom in and wheel-down to zoom out", () => {
    expect(wheelZoomScale(1, -100)).toBeGreaterThan(1);
    expect(wheelZoomScale(1, 100)).toBeLessThan(1);
  });

  it("normalizes line and page wheel deltas before moving the camera", () => {
    expect(wheelDeltaInPixels(2, 1, 500)).toBe(32);
    expect(wheelDeltaInPixels(2, 2, 500)).toBe(1000);
    expect(wheelDeltaInPixels(2, 0, 500)).toBe(2);
  });
});
