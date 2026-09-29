import type { NotebookObject, PointSample, StrokeObject } from "../domain/notebook";

type Point = Pick<PointSample, "x" | "y">;

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function strokeIntersectsPolygon(stroke: StrokeObject, polygon: Point[]): boolean {
  return stroke.points.some((point) => pointInPolygon(point, polygon));
}

export function objectIntersectsPolygon(object: NotebookObject, polygon: Point[]): boolean {
  if (polygon.length < 3 || object.kind === "connector") return false;
  if (object.kind === "stroke") return strokeIntersectsPolygon(object, polygon);

  const corners = [
    { x: object.x, y: object.y },
    { x: object.x + object.width, y: object.y },
    { x: object.x + object.width, y: object.y + object.height },
    { x: object.x, y: object.y + object.height },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  return polygon.some((point) =>
    point.x >= object.x
    && point.x <= object.x + object.width
    && point.y >= object.y
    && point.y <= object.y + object.height,
  );
}


type Box = { id: string; x: number; y: number; width: number; height: number };

/**
 * The top-most box under a point, with a little slack around each so a small
 * node is easy to hit with a finger. Later boxes are drawn on top, so they win.
 */
export function topmostBoxAt<T extends Box>(boxes: readonly T[], point: Point, slack = 0): T | undefined {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    if (point.x >= box.x - slack && point.x <= box.x + box.width + slack && point.y >= box.y - slack && point.y <= box.y + box.height + slack) return box;
  }
  return undefined;
}
