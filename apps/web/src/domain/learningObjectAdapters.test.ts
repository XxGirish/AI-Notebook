import { describe, expect, it } from "vitest";
import type { EquationCardObject, QuizCardObject, TextCardObject } from "./notebook";
import { learningObjectAdapter } from "./learningObjectAdapters";

const base = { id: "card", revision: 1, x: 0, y: 0, width: 1, height: 1 };
const text: TextCardObject = { ...base, kind: "text-card", title: "Motion", body: "Velocity changes with time." };
const equation: EquationCardObject = { ...base, kind: "equation-card", title: "Force", latex: "F=ma" };
const quiz: QuizCardObject = {
  ...base,
  kind: "quiz-card",
  prompt: "Which relation is correct?",
  options: [{ id: "a", label: "F=ma" }, { id: "b", label: "F=m/a" }],
  correctOptionId: "a",
  rationale: "Force is mass multiplied by acceleration.",
};

describe("learning object adapter", () => {
  it("validates semantic content and answer-key references", () => {
    expect(learningObjectAdapter.validate(quiz)).toEqual([]);
    expect(learningObjectAdapter.validate({ ...quiz, correctOptionId: "missing" })[0]).toContain("answer key");
  });

  it("measures each card type deterministically from semantic content", () => {
    expect(learningObjectAdapter.measure(text)).toEqual({ width: 320, height: 140 });
    expect(learningObjectAdapter.measure(equation)).toEqual({ width: 320, height: 140 });
    expect(learningObjectAdapter.measure(quiz)).toEqual({ width: 340, height: 260 });
    expect(learningObjectAdapter.measure({ ...text, body: "x".repeat(2_000) }).height).toBe(420);
  });

  it("creates isolated render and export models", () => {
    const render = learningObjectAdapter.render(quiz);
    const exported = learningObjectAdapter.toExport(quiz);
    expect(render).toEqual(exported);
    if (render.kind !== "quiz") return;
    render.options[0].label = "Changed outside document";
    expect(quiz.options[0].label).toBe("F=ma");
  });

  it("produces plain text without revealing quiz answers by default", () => {
    expect(learningObjectAdapter.toPlainText(text)).toBe("Motion\n\nVelocity changes with time.");
    expect(learningObjectAdapter.toPlainText(equation)).toBe("Force\n\nF=ma");
    expect(learningObjectAdapter.toPlainText(quiz)).not.toContain("Answer:");
    expect(learningObjectAdapter.toPlainText(quiz, { includeAnswer: true })).toContain("Answer: F=ma");
  });

  it("migrates a legacy card revision and rejects malformed records", () => {
    expect(learningObjectAdapter.migrate({ ...text, revision: undefined })).toMatchObject({ revision: 1, kind: "text-card" });
    expect(() => learningObjectAdapter.migrate({ ...quiz, options: [] })).toThrow(/migration failed/);
  });
});
