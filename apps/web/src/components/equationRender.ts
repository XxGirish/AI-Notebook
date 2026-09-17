import katex from "katex";

export type EquationRenderResult =
  | { valid: true; html: string }
  | { valid: false; message: string };

export function renderEquation(latex: string): EquationRenderResult {
  try {
    return {
      valid: true,
      html: katex.renderToString(latex, {
        throwOnError: true,
        trust: false,
        strict: "warn",
      }),
    };
  } catch {
    return { valid: false, message: "This equation could not be rendered. Edit its LaTeX to correct it." };
  }
}
