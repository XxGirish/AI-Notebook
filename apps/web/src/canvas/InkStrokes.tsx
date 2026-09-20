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

// Highlighters draw first so pen ink stays crisp on top of them.
const PASSES = ["highlighter", "pen"] as const;

/**
 * Every committed stroke is drawn by this one scene function, from the arrays
 * handed over as node attributes. The page used to be a Konva node per stroke,
 * which meant React reconciled and Konva diffed a thousand nodes to add one:
 * that cost 52.6 ms at the 95th percentile per commit on a 1,180-stroke page,
 * against 18.4 ms at 140 strokes (docs/decisions/0010-single-ink-node.md).
 * Filling the cached Path2Ds is the only work left that follows page size.
 */
export function drawInk(context: Context, shape: KonvaShape) {
  const strokes = shape.getAttr("strokes") as StrokeObject[] | undefined;
  if (!strokes || strokes.length === 0) return;
  const selectedIds = shape.getAttr("selectedIds") as Set<string>;
  const transientPositions = shape.getAttr("transientPositions") as Record<string, Position>;
  const outlineWidth = 2 / (shape.getAttr("cameraScale") as number);
  const native = context._context;

  for (const pass of PASSES) {
    let passStarted = false;
    for (const stroke of strokes) {
      if (stroke.tool !== pass) continue;
      if (pass === "highlighter" && !passStarted) {
        native.save();
        native.globalAlpha = 0.3;
        native.globalCompositeOperation = "multiply";
        passStarted = true;
      }

      // A stroke being dragged is offset here rather than committed, so the
      // document is not rewritten on every pointer move.
      const position = transientPositions[stroke.id];
      if (position) {
        native.save();
        native.translate(position.x - stroke.x, position.y - stroke.y);
      }

      const path = strokePath2D(stroke);
      native.fillStyle = stroke.color;
      native.fill(path);
      if (selectedIds.has(stroke.id)) {
        native.lineWidth = outlineWidth;
        native.strokeStyle = "#ef8c45";
        native.stroke(path);
      }

      if (position) native.restore();
    }
    if (passStarted) native.restore();
  }
}

/**
 * Committed ink. Memoized so that canvas state unrelated to strokes (lasso
 * preview, palm contacts, notices) does not redraw the page.
 */
export const InkStrokes = memo(function InkStrokes({ strokes, selectedIds, transientPositions, cameraScale }: Props) {
  return (
    <Shape
      sceneFunc={drawInk}
      strokes={strokes}
      selectedIds={selectedIds}
      transientPositions={transientPositions}
      cameraScale={cameraScale}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
});
