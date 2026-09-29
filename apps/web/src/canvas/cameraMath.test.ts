import { describe, expect, it } from "vitest";
import { cameraCentredOn, pinchCamera, MAX_ZOOM, MIN_ZOOM, wheelDeltaInPixels, wheelZoomScale, zoomCameraAt } from "./cameraMath";

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

describe("centring on an object", () => {
  it("keeps the zoom and moves the box's middle to the viewport's middle", () => {
    const camera = cameraCentredOn({ x: 5, y: 5, scale: 2 }, { x: 100, y: 50, width: 40, height: 20 }, { width: 800, height: 600 });
    expect(camera.scale).toBe(2);
    expect(120 * camera.scale + camera.x).toBe(400);
    expect(60 * camera.scale + camera.y).toBe(300);
  });
});

describe("pinch", () => {
  const start = { x: 40, y: 20, scale: 1 };

  it("zooms by the change in finger distance around the fingers' midpoint", () => {
    const camera = pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(camera.scale).toBe(2);
    // The world point that was under the midpoint (150, 100) is still there.
    const worldX = (150 - start.x) / start.scale;
    expect(worldX * camera.scale + camera.x).toBeCloseTo(150);
  });

  it("pans with the fingers when their distance does not change", () => {
    const camera = pinchCamera(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 130, y: 160 }, { x: 230, y: 160 });
    expect(camera).toEqual({ x: 70, y: 80, scale: 1 });
  });

  it("stays within the zoom limits and ignores fingers that start on the same spot", () => {
    expect(pinchCamera(start, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1_000, y: 0 }).scale).toBe(MAX_ZOOM);
    expect(pinchCamera(start, { x: 0, y: 0 }, { x: 1_000, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }).scale).toBe(MIN_ZOOM);
    expect(pinchCamera(start, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 5 }, { x: 30, y: 5 }).scale).toBe(1);
  });
});
