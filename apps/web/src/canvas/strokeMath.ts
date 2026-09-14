import type { PointSample, StrokeObject } from "../domain/notebook";

export function appendDistinctPoints(
  current: PointSample[],
  candidates: PointSample[],
  minimumDistance = 0.35,
): PointSample[] {
  const result = [...current];
  for (const candidate of candidates) {
    const previous = result.at(-1);
    if (!previous || Math.hypot(candidate.x - previous.x, candidate.y - previous.y) >= minimumDistance) {
      result.push(candidate);
    }
  }
  return result;
}

function distanceToSegment(point: PointSample, start: PointSample, end: PointSample): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + amount * dx), point.y - (start.y + amount * dy));
}

export function strokeIntersectsPoint(stroke: StrokeObject, point: PointSample, radius: number): boolean {
  const threshold = radius + stroke.size / 2;
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= threshold) return true;
  }
  return stroke.points.length === 1 && distanceToSegment(point, stroke.points[0], stroke.points[0]) <= threshold;
}

