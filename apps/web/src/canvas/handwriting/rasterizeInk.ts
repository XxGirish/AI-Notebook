import type { StrokeObject } from "../../domain/notebook";
import { getStrokePath } from "../strokePath";
import { inkBounds } from "./handwritingLayout";

export type InkRaster = { data: Uint8ClampedArray; width: number; height: number };

const INK_HEIGHT_PX = 64;
const PADDING_PX = 16;
const MAX_WIDTH_PX = 1_024;

/**
 * Renders one line of vector ink as dark-on-white pixels, the input the
 * recognizer was trained on. Only the given strokes are drawn, so nearby notes
 * never leak into recognition, and the canonical strokes are left untouched.
 */
export function rasterizeInkLine(strokes: StrokeObject[]): InkRaster {
  const bounds = inkBounds(strokes);
  const scale = Math.min(
    INK_HEIGHT_PX / Math.max(1, bounds.height),
    (MAX_WIDTH_PX - PADDING_PX * 2) / Math.max(1, bounds.width),
    4,
  );
  const inkWidth = Math.ceil(bounds.width * scale);
  const inkHeight = Math.ceil(bounds.height * scale);
  // Keep short words and single letters from being stretched into slivers.
  const width = Math.max(inkWidth, inkHeight) + PADDING_PX * 2;
  const height = inkHeight + PADDING_PX * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is unavailable for handwriting recognition.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.translate(PADDING_PX + (width - PADDING_PX * 2 - inkWidth) / 2, PADDING_PX);
  context.scale(scale, scale);
  context.translate(-bounds.x, -bounds.y);
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  context.lineJoin = "round";
  context.lineCap = "round";
  // Very fine pens shrink below a pixel at this scale; a thin outline keeps them legible.
  context.lineWidth = 1.5 / scale;
  for (const stroke of strokes) {
    const path = new Path2D(getStrokePath(stroke.points, stroke.size, "pen"));
    context.fill(path);
    context.stroke(path);
  }

  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
