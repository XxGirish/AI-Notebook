import { describe, expect, it } from "vitest";
import { LINED_LEFT_MARGIN, PAPER_RULE_SPACING } from "../domain/paper";
import { backgroundMarks, GRAPH_MAJOR_EVERY, gridPositions, isCanvasBackground, patternStep, readCanvasBackground } from "./canvasBackground";

const at = (x: number, y: number, scale: number) => ({ x, y, scale });

describe("canvas background", () => {
  it("places marks on world multiples of the spacing, wherever the camera is", () => {
    const camera = at(-1000.5, 37, 1.5);
    const marks = backgroundMarks("dots", camera, 800, 600);
    if (marks.kind !== "dots") throw new Error("expected dots");
    for (const screen of marks.xs) {
      const world = (screen - camera.x) / camera.scale;
      expect(Math.abs(world / PAPER_RULE_SPACING - Math.round(world / PAPER_RULE_SPACING))).toBeLessThan(1e-9);
    }
    expect(marks.xs[0]).toBeGreaterThanOrEqual(0);
    expect(marks.xs[0]).toBeLessThan(PAPER_RULE_SPACING * camera.scale);
    expect(marks.xs.at(-1)).toBeLessThanOrEqual(800);
  });

  it("thins the dots when zoomed out instead of packing them tighter than the minimum gap", () => {
    expect(patternStep(1, 14, 2)).toBe(PAPER_RULE_SPACING);
    expect(patternStep(0.25, 14, 2)).toBe(PAPER_RULE_SPACING * 2);
    const marks = backgroundMarks("dots", at(0, 0, 0.25), 400, 400);
    if (marks.kind !== "dots") throw new Error("expected dots");
    expect(marks.xs[1] - marks.xs[0]).toBeGreaterThanOrEqual(14);
  });

  it("keeps lined rows at the paper's spacing across the zoom range, so writing stays on the lines", () => {
    for (const scale of [0.25, 1, 3]) expect(patternStep(scale, 6, 2)).toBe(PAPER_RULE_SPACING);
  });

  it("draws the ruled margin where the paper sheet's margin is, and only while it is in view", () => {
    const ruled = backgroundMarks("ruled", at(10, 0, 2), 800, 600);
    expect(ruled).toMatchObject({ kind: "lines", marginX: 10 + LINED_LEFT_MARGIN * 2 });
    expect(backgroundMarks("ruled", at(-1000, 0, 1), 800, 600)).not.toHaveProperty("marginX");
    expect(backgroundMarks("lined", at(10, 0, 2), 800, 600)).not.toHaveProperty("marginX");
  });

  it("splits graph paper into minor lines and a major line every fifth square, without drawing one twice", () => {
    const marks = backgroundMarks("graph", at(0, 0, 1), 800, 10);
    if (marks.kind !== "graph") throw new Error("expected graph");
    const major = PAPER_RULE_SPACING * GRAPH_MAJOR_EVERY;
    expect(marks.majorXs).toEqual([0, major, major * 2, major * 3, major * 4, major * 5].filter((x) => x <= 800));
    expect(marks.minorXs.some((x) => marks.majorXs.includes(x))).toBe(false);
    expect(marks.minorXs.length + marks.majorXs.length).toBe(gridPositions(0, 1, PAPER_RULE_SPACING, 800).length);
  });

  it("draws nothing for plain, and falls back to the dot grid without stored or valid preference", () => {
    expect(backgroundMarks("plain", at(0, 0, 1), 800, 600)).toEqual({ kind: "none" });
    expect(readCanvasBackground()).toBe("dots");
    expect(isCanvasBackground("graph")).toBe(true);
    expect(isCanvasBackground("grid")).toBe(false);
  });
});
