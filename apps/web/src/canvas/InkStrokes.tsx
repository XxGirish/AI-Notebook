import { memo } from "react";
import { Shape } from "react-konva";
import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import type { PointSample, StrokeObject } from "../domain/notebook";
import { getStrokeOutline } from "./strokePath";
import { outlineToPath2D } from "./wetInk";

type Position = { x: number; y: number };

type Props = {
  strokes: StrokeObject[];
  selectedIds: Set<string>;
  transientPositions: Record<string, Position>;
  cameraScale: number;
};

// Faithful outlines carry several hundred points per word. Replayed as Konva
// path commands they cost ~12 ms per redraw of an 800-stroke page (pan, zoom,
// every commit); as a prebuilt Path2D each stroke is one native fill.
const pathCache = new WeakMap<PointSample[], { size: number; tool: StrokeObject["tool"]; path: Path2D }>();

function strokePath2D(stroke: StrokeObject): Path2D {
  const cached = pathCache.get(stroke.points);
  if (cached && cached.size === stroke.size && cached.tool === stroke.tool) return cached.path;
  const path = outlineToPath2D(getStrokeOutline(stroke.points, stroke.size, stroke.tool));
  pathCache.set(stroke.points, { size: stroke.size, tool: stroke.tool, path });
  return path;
}

// One shared scene function: the path travels as a node attribute, so props
// stay equal between renders and react-konva has nothing to update.
function drawInk(context: Context, shape: KonvaShape) {
  const path = shape.getAttr("inkPath") as Path2D | undefined;
  if (!path) return;
  const native = context._context;
  native.fillStyle = shape.fill() as string;
  native.fill(path);
  const outline = shape.strokeWidth();
  if (outline > 0) {
    native.lineWidth = outline;
    native.strokeStyle = shape.stroke() as string;
    native.stroke(path);
  }
}

/**
 * Committed ink. Memoized so that canvas state unrelated to strokes (lasso
 * preview, palm contacts, notices) does not reconcile every stroke on the page.
 * Highlighters draw first so pen ink stays crisp on top of them.
 */
export const InkStrokes = memo(function InkStrokes({ strokes, selectedIds, transientPositions, cameraScale }: Props) {
  const render = (stroke: StrokeObject) => {
    const selected = selectedIds.has(stroke.id);
    const position = transientPositions[stroke.id];
    const highlighter = stroke.tool === "highlighter";
    return (
      <Shape
        key={stroke.id}
        sceneFunc={drawInk}
        inkPath={strokePath2D(stroke)}
        fill={stroke.color}
        opacity={highlighter ? 0.3 : 1}
        globalCompositeOperation={highlighter ? "multiply" : "source-over"}
        stroke={selected ? "#ef8c45" : undefined}
        strokeWidth={selected ? 2 / cameraScale : 0}
        x={position ? position.x - stroke.x : 0}
        y={position ? position.y - stroke.y : 0}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  };
  return (
    <>
      {strokes.filter((stroke) => stroke.tool === "highlighter").map(render)}
      {strokes.filter((stroke) => stroke.tool === "pen").map(render)}
    </>
  );
});
