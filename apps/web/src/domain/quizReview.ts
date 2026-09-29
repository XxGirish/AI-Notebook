import type { QuizCardObject } from "./notebook";
import { summarizeQuizAttempts, type QuizAttemptRecord } from "./quizAttempts";

/**
 * What the recorded answers say about each quiz on a page, in plain terms.
 * There is deliberately no score: a handful of self-study answers cannot
 * support a percentage, and a correct retry after seeing the rationale is not
 * the same evidence as a correct first try.
 */
export type QuizReviewStatus =
  /** The first answer to this version was wrong, or came after revealing the answer. */
  | "revisit"
  | "not-answered"
  /** Answered before, but the question has been edited since. */
  | "changed"
  | "first-try-correct";

export type QuizReviewItem = {
  quizId: string;
  prompt: string;
  status: QuizReviewStatus;
  attempts: number;
  lastAnsweredAt?: number;
};

const STATUS_ORDER: Record<QuizReviewStatus, number> = { revisit: 0, "not-answered": 1, changed: 2, "first-try-correct": 3 };

export const QUIZ_REVIEW_LABELS: Record<QuizReviewStatus, string> = {
  revisit: "Worth another look",
  "not-answered": "Not answered yet",
  changed: "Edited since you answered",
  "first-try-correct": "Right first time",
};

export function reviewQuizzes(quizzes: readonly QuizCardObject[], attempts: readonly QuizAttemptRecord[]): QuizReviewItem[] {
  const items = quizzes.map((quiz, readingIndex) => {
    const summary = summarizeQuizAttempts(quiz, attempts);
    const status: QuizReviewStatus = summary.attempts === 0
      ? (summary.earlierVersionAttempts > 0 ? "changed" : "not-answered")
      : summary.firstTryAssistance === "revealed" || !summary.firstTryCorrect ? "revisit" : "first-try-correct";
    return {
      readingIndex,
      item: {
        quizId: quiz.id,
        prompt: quiz.prompt,
        status,
        attempts: summary.attempts,
        ...(summary.lastAnsweredAt !== undefined ? { lastAnsweredAt: summary.lastAnsweredAt } : {}),
      },
    };
  });
  // Within a status, the least recently practised comes first; never-answered quizzes keep reading order.
  items.sort((left, right) =>
    STATUS_ORDER[left.item.status] - STATUS_ORDER[right.item.status]
    || (left.item.lastAnsweredAt ?? 0) - (right.item.lastAnsweredAt ?? 0)
    || left.readingIndex - right.readingIndex);
  return items.map(({ item }) => item);
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** "today", "yesterday", "5 days ago": recency by calendar day in the viewer's time zone. */
export function describeRecency(at: number, now: number): string {
  const startOfDay = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function summarizeReview(items: readonly QuizReviewItem[]): string {
  if (items.length === 0) return "No quizzes on this page";
  const count = (status: QuizReviewStatus) => items.filter((item) => item.status === status).length;
  const parts = [`${items.length} quiz${items.length === 1 ? "" : "zes"}`];
  if (count("revisit") > 0) parts.push(`${count("revisit")} worth another look`);
  if (count("not-answered") > 0) parts.push(`${count("not-answered")} not answered`);
  if (count("changed") > 0) parts.push(`${count("changed")} edited since answered`);
  return parts.join(" · ");
}
