export type CanvasPoint = { x: number; y: number };
export type CanvasBounds = CanvasPoint & { width: number; height: number };

export function boundsFromPoints(start: CanvasPoint, end: CanvasPoint): CanvasBounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
