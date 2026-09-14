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

