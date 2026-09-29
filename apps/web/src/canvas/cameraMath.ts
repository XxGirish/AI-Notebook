export type Camera = { x: number; y: number; scale: number };
export type ScreenPoint = { x: number; y: number };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export function clampZoom(scale: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function zoomCameraAt(camera: Camera, nextScale: number, anchor: ScreenPoint): Camera {
  const scale = clampZoom(nextScale);
  const worldX = (anchor.x - camera.x) / camera.scale;
  const worldY = (anchor.y - camera.y) / camera.scale;
  return { scale, x: anchor.x - worldX * scale, y: anchor.y - worldY * scale };
}

export function wheelDeltaInPixels(delta: number, deltaMode: number, viewportHeight: number) {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * viewportHeight;
  return delta;
}

export function wheelZoomScale(currentScale: number, deltaYInPixels: number) {
  return currentScale * Math.exp(-deltaYInPixels * 0.0025);
}

/** The camera, at its current zoom, that puts the middle of a world-space box in the middle of the viewport. */
export function cameraCentredOn(camera: Camera, box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): Camera {
  return {
    scale: camera.scale,
    x: viewport.width / 2 - (box.x + box.width / 2) * camera.scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * camera.scale,
  };
}

/**
 * The camera during a two-finger pinch. The world point that was under the
 * fingers' midpoint when the pinch began stays under their current midpoint,
 * and the zoom follows the change in distance between them, so the page moves
 * with the fingers as if held. Points are in viewport pixels.
 */
export function pinchCamera(start: Camera, startA: ScreenPoint, startB: ScreenPoint, a: ScreenPoint, b: ScreenPoint): Camera {
  const startDistance = Math.hypot(startB.x - startA.x, startB.y - startA.y);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const scale = startDistance > 0 ? clampZoom(start.scale * (distance / startDistance)) : start.scale;
  const startMid = { x: (startA.x + startB.x) / 2, y: (startA.y + startB.y) / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const worldX = (startMid.x - start.x) / start.scale;
  const worldY = (startMid.y - start.y) / start.scale;
  return { scale, x: mid.x - worldX * scale, y: mid.y - worldY * scale };
}

/**
 * After the viewport changes size (a rotation, a window resize, a panel
 * opening), keeps the world point that was in the middle of the view in the
 * middle, at the same zoom, rather than pinning the top-left corner.
 */
export function recentreCamera(camera: Camera, previous: { width: number; height: number }, next: { width: number; height: number }): Camera {
  return {
    scale: camera.scale,
    x: camera.x + (next.width - previous.width) / 2,
    y: camera.y + (next.height - previous.height) / 2,
  };
}

/**
 * How far to move the view up so a focused editor clears the on-screen
 * keyboard, in screen pixels; zero when it is already visible.
 */
export function keyboardRevealOffset(editor: { top: number; bottom: number }, visibleBottom: number, margin = 16): number {
  const overlap = editor.bottom + margin - visibleBottom;
  if (overlap <= 0) return 0;
  // Never push the top of the editor above the visible area to show its bottom.
  return Math.max(0, Math.min(overlap, editor.top - margin));
}
