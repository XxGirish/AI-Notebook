import { getStroke } from "perfect-freehand";
import type { PointSample, StrokeObject } from "../domain/notebook";

export function getStrokePath(
  points: PointSample[],
  size: number,
  tool: StrokeObject["tool"] = "pen",
): string {
  const outline = getStroke(
    points.map((point) => [point.x, point.y, point.pressure]),
    {
      size,
      thinning: tool === "highlighter" ? 0 : 0.68,
      smoothing: tool === "highlighter" ? 0.7 : 0.82,
      streamline: tool === "highlighter" ? 0.5 : 0.62,
      simulatePressure: false,
      easing: (pressure) => pressure,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
    },
  );

  if (outline.length < 3) return "";

  const average = (a: number, b: number) => (a + b) / 2;
  let path = `M ${outline[0][0]} ${outline[0][1]} Q`;

  for (let index = 1; index < outline.length; index += 1) {
    const point = outline[index];
    const next = outline[(index + 1) % outline.length];
    path += ` ${point[0]} ${point[1]} ${average(point[0], next[0])} ${average(point[1], next[1])}`;
  }

  return `${path} Z`;
}
