import { LINED_LEFT_MARGIN, PAPER_COLORS, PAPER_RULE_SPACING } from "../domain/paper";
import type { Camera } from "./cameraMath";

/**
 * The pattern behind the whole infinite canvas. It is a viewing preference of
 * this device, like the touch mode, not part of the notebook: it is not saved
 * in pages, archives or exports, and changing it never touches the document.
 */
export type CanvasBackground = "dots" | "lined" | "ruled" | "graph" | "plain";

export const CANVAS_BACKGROUNDS: readonly CanvasBackground[] = ["dots", "lined", "ruled", "graph", "plain"];
export const CANVAS_BACKGROUND_LABELS: Record<CanvasBackground, string> = {
  dots: "Dot grid",
  lined: "Lined",
  ruled: "Ruled with margin",
  graph: "Graph paper",
  plain: "Plain",
};
export const DEFAULT_CANVAS_BACKGROUND: CanvasBackground = "dots";

export const isCanvasBackground = (value: unknown): value is CanvasBackground =>
  typeof value === "string" && (CANVAS_BACKGROUNDS as readonly string[]).includes(value);

const STORAGE_KEY = "ai-notebook.canvas.background";

export function readCanvasBackground(): CanvasBackground {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isCanvasBackground(value) ? value : DEFAULT_CANVAS_BACKGROUND;
  } catch {
    return DEFAULT_CANVAS_BACKGROUND;
  }
}

export function writeCanvasBackground(value: CanvasBackground) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // A remembered pattern is a convenience; the canvas works without it.
  }
}

export const CANVAS_BACKGROUND_COLORS = {
  dot: "#c8c1b0",
  rule: PAPER_COLORS.rule,
  margin: PAPER_COLORS.margin,
  graphMinor: "#e1e9ee",
  graphMajor: "#bcd0dc",
};

/** Graph paper draws a bold line every this many squares. */
export const GRAPH_MAJOR_EVERY = 5;

/**
 * Spacing in world units, so ink lines up with the pattern at every zoom; it
 * matches the paper sheets' rules, so switching patterns keeps the same rows.
 * Zoomed far out, the pattern thins to a coarser multiple rather than turning
 * the page grey: `factor` is how much coarser each step is.
 */
export function patternStep(scale: number, minScreenGap: number, factor: number, base = PAPER_RULE_SPACING): number {
  let step = base;
  while (step * scale < minScreenGap) step *= factor;
  return step;
}

/**
 * Viewport positions of the world multiples of `step` along one axis, from 0
 * up to `length` pixels. `keep` sees each multiple's index (world / step).
 */
export function gridPositions(offset: number, scale: number, step: number, length: number, keep: (index: number) => boolean = () => true): number[] {
  const positions: number[] = [];
  for (let index = Math.ceil(-offset / scale / step); ; index += 1) {
    const screen = offset + index * step * scale;
    if (screen > length) break;
    if (keep(index)) positions.push(screen);
  }
  return positions;
}

export type BackgroundMarks =
  | { kind: "none" }
  | { kind: "dots"; xs: number[]; ys: number[] }
  | { kind: "lines"; ys: number[]; marginX?: number }
  | { kind: "graph"; minorXs: number[]; minorYs: number[]; majorXs: number[]; majorYs: number[] };

/** What to draw for a viewport of `width` by `height` pixels, in viewport pixels. */
export function backgroundMarks(style: CanvasBackground, camera: Camera, width: number, height: number): BackgroundMarks {
  const { x, y, scale } = camera;
  if (style === "dots") {
    const step = patternStep(scale, 14, 2);
    return { kind: "dots", xs: gridPositions(x, scale, step, width), ys: gridPositions(y, scale, step, height) };
  }
  if (style === "lined" || style === "ruled") {
    const ys = gridPositions(y, scale, patternStep(scale, 6, 2), height);
    const marginX = x + LINED_LEFT_MARGIN * scale;
    return { kind: "lines", ys, ...(style === "ruled" && marginX >= 0 && marginX <= width ? { marginX } : {}) };
  }
  if (style === "graph") {
    // Thinning by the major interval keeps each remaining line on a world multiple of the one before.
    const minor = patternStep(scale, 8, GRAPH_MAJOR_EVERY);
    const isMinor = (index: number) => index % GRAPH_MAJOR_EVERY !== 0;
    const isMajor = (index: number) => index % GRAPH_MAJOR_EVERY === 0;
    return {
      kind: "graph",
      minorXs: gridPositions(x, scale, minor, width, isMinor),
      minorYs: gridPositions(y, scale, minor, height, isMinor),
      majorXs: gridPositions(x, scale, minor, width, isMajor),
      majorYs: gridPositions(y, scale, minor, height, isMajor),
    };
  }
  return { kind: "none" };
}
