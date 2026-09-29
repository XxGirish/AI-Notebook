import { describe, expect, it } from "vitest";
import type { QuizCardObject } from "./notebook";
import { createQuizAttempt, describeQuizAttempts, gradeQuizAnswer, summarizeQuizAttempts, type QuizAttemptRecord } from "./quizAttempts";

const quiz: QuizCardObject = {
  id: "quiz-1",
  revision: 1,
  kind: "quiz-card",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  prompt: "Which is a vector?",
  options: [{ id: "speed", label: "Speed" }, { id: "velocity", label: "Velocity" }],
  correctOptionId: "velocity",
  rationale: "Velocity has a direction.",
};

function answer(target: QuizCardObject, optionId: string, previous: QuizAttemptRecord[], at: number) {
  return [...previous, createQuizAttempt(target, "page-1", optionId, previous, at, `attempt-${at}`)];
}

describe("quiz attempts", () => {
  it("grades against the stored answer key without any request", () => {
    expect(gradeQuizAnswer(quiz, "velocity")).toBe(true);
    expect(gradeQuizAnswer(quiz, "speed")).toBe(false);
    expect(() => gradeQuizAnswer(quiz, "acceleration")).toThrow(/not part of quiz/);
  });

  it("grades by option id, so reordering the options cannot change correctness", () => {
    const shuffled = { ...quiz, options: [...quiz.options].reverse() };
    expect(gradeQuizAnswer(shuffled, "velocity")).toBe(true);
  });

  it("numbers retries per question version and keeps the version with each answer", () => {
    let attempts = answer(quiz, "speed", [], 1);
    attempts = answer(quiz, "velocity", attempts, 2);
    expect(attempts.map((attempt) => [attempt.sequence, attempt.correct, attempt.quizRevision])).toEqual([[1, false, 1], [2, true, 1]]);

    const edited = { ...quiz, revision: 2 };
    attempts = answer(edited, "velocity", attempts, 3);
    expect(attempts[2]).toMatchObject({ sequence: 1, quizRevision: 2, correct: true });
  });

  it("reports the first try separately so a correct retry is not counted as knowing it", () => {
    let attempts = answer(quiz, "speed", [], 1);
    attempts = answer(quiz, "velocity", attempts, 2);
    attempts = answer(quiz, "velocity", attempts, 3);
    const summary = summarizeQuizAttempts(quiz, attempts);
    expect(summary).toEqual({ attempts: 3, firstTryCorrect: false, earlierVersionAttempts: 0, lastAnsweredAt: 3 });
    expect(describeQuizAttempts(summary)).toBe("First try incorrect · 2 retries");
  });

  it("sets answers to an earlier version of the question apart", () => {
    const attempts = answer(quiz, "velocity", [], 1);
    const edited = { ...quiz, revision: 2, prompt: "Which quantity has direction?" };
    const summary = summarizeQuizAttempts(edited, attempts);
    expect(summary).toMatchObject({ attempts: 0, firstTryCorrect: undefined, earlierVersionAttempts: 1 });
    expect(describeQuizAttempts(summary)).toBe("1 answer to an earlier version");
    expect(describeQuizAttempts(summarizeQuizAttempts(quiz, []))).toBeUndefined();
  });

  it("ignores attempts on other quizzes", () => {
    const other = { ...quiz, id: "quiz-2" };
    const attempts = answer(other, "speed", [], 1);
    expect(summarizeQuizAttempts(quiz, attempts).attempts).toBe(0);
    expect(createQuizAttempt(quiz, "page-1", "speed", attempts, 2, "x").sequence).toBe(1);
  });
});
