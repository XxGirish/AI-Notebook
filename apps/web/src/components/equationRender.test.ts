import { describe, expect, it } from "vitest";
import { renderEquation } from "./equationRender";

describe("equation rendering", () => {
  it("renders valid LaTeX with KaTeX", () => {
    const result = renderEquation(String.raw`x = \frac{-b}{2a}`);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.html).toContain("katex");
  });

  it("returns a recoverable result for invalid LaTeX", () => {
    expect(renderEquation(String.raw`\frac{`)).toEqual({
      valid: false,
      message: "This equation could not be rendered. Edit its LaTeX to correct it.",
    });
  });
});
