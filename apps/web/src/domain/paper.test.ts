import { describe, expect, it } from "vitest";
import { createNotebookPage, setPagePaper } from "./pages";
import { isPaperStyle, PAPER_RULE_SPACING, paperLines } from "./paper";

describe("paper", () => {
  it("rules lined paper across the page with one margin line", () => {
    const lines = paperLines("lined", 1280, 820);
    const rules = lines.filter((line) => line.kind === "rule");
    expect(lines.filter((line) => line.kind === "margin")).toHaveLength(1);
    expect(rules.every((line) => line.x1 === 0 && line.x2 === 1280 && line.y1 === line.y2 && line.y1 < 820)).toBe(true);
    expect(rules[1].y1 - rules[0].y1).toBe(PAPER_RULE_SPACING);
  });

  it("draws a grid in both directions and nothing for plain paper", () => {
    const grid = paperLines("grid", 320, 160);
    expect(grid.filter((line) => line.x1 === line.x2)).toHaveLength(9);
    expect(grid.filter((line) => line.y1 === line.y2)).toHaveLength(4);
    expect(paperLines("plain", 320, 160)).toEqual([]);
  });

  it("sets and clears a page's paper as a revisioned page change", () => {
    const page = createNotebookPage("Notes", 100);
    const lined = setPagePaper(page, "lined", 50);
    expect(lined).toMatchObject({ paper: "lined", updatedAt: 101 });
    expect(setPagePaper(lined, undefined, 500)).not.toHaveProperty("paper");
    expect(isPaperStyle("grid")).toBe(true);
    expect(isPaperStyle("dotted")).toBe(false);
  });
});
