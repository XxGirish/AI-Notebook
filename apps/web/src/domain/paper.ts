/**
 * An optional sheet of paper inside the infinite canvas. The page keeps one
 * scene model: the paper is a background at the page's nominal size, not a
 * clip, so writing past its edge is kept and exported as before.
 */
export type PaperStyle = "plain" | "lined" | "grid";

export const PAPER_STYLES: readonly PaperStyle[] = ["plain", "lined", "grid"];
export const PAPER_LABELS: Record<PaperStyle | "none", string> = { none: "No paper", plain: "Plain paper", lined: "Lined paper", grid: "Grid paper" };

/** Close to college ruling at the default zoom, and a comfortable size for handwriting. */
export const PAPER_RULE_SPACING = 32;
const LINED_TOP_MARGIN = 96;
export const LINED_LEFT_MARGIN = 96;

export const isPaperStyle = (value: unknown): value is PaperStyle => typeof value === "string" && (PAPER_STYLES as readonly string[]).includes(value);

export type PaperLine = { x1: number; y1: number; x2: number; y2: number; kind: "rule" | "margin" };

/** The lines of a sheet in page coordinates, shared by the canvas and static export so both look the same. */
export function paperLines(style: PaperStyle, width: number, height: number): PaperLine[] {
  const lines: PaperLine[] = [];
  if (style === "lined") {
    for (let y = LINED_TOP_MARGIN; y < height; y += PAPER_RULE_SPACING) lines.push({ x1: 0, y1: y, x2: width, y2: y, kind: "rule" });
    lines.push({ x1: LINED_LEFT_MARGIN, y1: 0, x2: LINED_LEFT_MARGIN, y2: height, kind: "margin" });
  } else if (style === "grid") {
    for (let y = PAPER_RULE_SPACING; y < height; y += PAPER_RULE_SPACING) lines.push({ x1: 0, y1: y, x2: width, y2: y, kind: "rule" });
    for (let x = PAPER_RULE_SPACING; x < width; x += PAPER_RULE_SPACING) lines.push({ x1: x, y1: 0, x2: x, y2: height, kind: "rule" });
  }
  return lines;
}

export const PAPER_COLORS = { sheet: "#ffffff", edge: "#d9d3c5", rule: "#c9dbe6", margin: "#e8a9a3" };
