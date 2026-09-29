import { describe, expect, it } from "vitest";
import type { QuizCardObject } from "./notebook";
import { createQuizAttempt, type QuizAttemptRecord } from "./quizAttempts";
import { describeRecency, reviewQuizzes, summarizeReview } from "./quizReview";

const quiz = (id: string, revision = 1): QuizCardObject => ({
  id,
  revision,
  kind: "quiz-card",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  prompt: `Question ${id}`,
  options: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
  correctOptionId: "a",
  rationale: "Because.",
});

const answer = (target: QuizCardObject, optionId: string, previous: QuizAttemptRecord[], at: number, assistance?: "hint" | "revealed") =>
  [...previous, createQuizAttempt(target, "page", optionId, previous, at, `${target.id}-${at}`, assistance)];

describe("quiz review", () => {
  it("puts quizzes worth another look first, then unanswered, edited, and right-first-time ones", () => {
    const wrong = quiz("wrong");
    const unanswered = quiz("unanswered");
    const right = quiz("right");
    const peeked = quiz("peeked");
    const edited = quiz("edited", 2);
    let attempts = answer(right, "a", [], 10);
    attempts = answer(wrong, "b", attempts, 20);
    attempts = answer(wrong, "a", attempts, 30);
    attempts = answer(peeked, "a", attempts, 5, "revealed");
    attempts = answer(quiz("edited", 1), "a", attempts, 40);

    const items = reviewQuizzes([right, unanswered, wrong, edited, peeked], attempts);
    expect(items.map((item) => [item.quizId, item.status])).toEqual([
      ["peeked", "revisit"],
      ["wrong", "revisit"],
      ["unanswered", "not-answered"],
      ["edited", "changed"],
      ["right", "first-try-correct"],
    ]);
    expect(items.find((item) => item.quizId === "wrong")).toMatchObject({ attempts: 2, lastAnsweredAt: 30 });
    expect(summarizeReview(items)).toBe("5 quizzes · 2 worth another look · 1 not answered · 1 edited since answered");
  });

  it("counts a correct first try made with a hint as right first time", () => {
    const hinted = quiz("hinted");
    expect(reviewQuizzes([hinted], answer(hinted, "a", [], 1, "hint"))[0].status).toBe("first-try-correct");
  });

  it("keeps a correct retry from hiding a wrong first try", () => {
    const target = quiz("q");
    const attempts = answer(target, "a", answer(target, "b", [], 1), 2);
    expect(reviewQuizzes([target], attempts)[0].status).toBe("revisit");
  });

  it("describes recency by calendar day", () => {
    const now = new Date(2026, 8, 29, 9, 0).getTime();
    expect(describeRecency(new Date(2026, 8, 29, 0, 5).getTime(), now)).toBe("today");
    expect(describeRecency(new Date(2026, 8, 28, 23, 55).getTime(), now)).toBe("yesterday");
    expect(describeRecency(new Date(2026, 8, 22, 12, 0).getTime(), now)).toBe("7 days ago");
    expect(summarizeReview([])).toBe("No quizzes on this page");
  });
});
