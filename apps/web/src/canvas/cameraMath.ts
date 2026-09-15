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
