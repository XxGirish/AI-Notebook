import type { QuizCardObject } from "./notebook";

/**
 * One answer to one version of a quiz. Records are never edited or merged:
 * grading happens once, on the device, against the question as it stood when
 * it was answered, and the question's revision is kept with the answer so a
 * later edit cannot silently change what an old attempt meant.
 */
export type QuizAttemptRecord = {
  id: string;
  pageId: string;
  quizId: string;
  /** The quiz object's revision when it was answered. */
  quizRevision: number;
  chosenOptionId: string;
  correct: boolean;
  /** 1 for the first answer to this revision of the quiz, 2 for the first retry, and so on. */
  sequence: number;
  answeredAt: number;
  /** The most help seen on this version of the quiz before answering; absent when there was none. */
  assistance?: QuizAssistance;
};

/** A hint rules out one wrong option; a reveal shows the answer key and rationale. */
export type QuizAssistance = "hint" | "revealed";

export const strongerAssistance = (current: QuizAssistance | undefined, next: QuizAssistance): QuizAssistance => (current === "revealed" ? current : next);

/**
 * A local hint that needs no request: one wrong option to rule out. With only
 * two options that would give the answer away, so there is no hint. The
 * choice is stable for a given question, so reopening the card shows the same
 * hint rather than letting repeated hints eliminate every wrong answer.
 */
export function quizHintOptionId(quiz: QuizCardObject): string | undefined {
  const wrong = quiz.options.filter((option) => option.id !== quiz.correctOptionId);
  if (quiz.options.length < 3 || wrong.length === 0) return undefined;
  const seed = [...`${quiz.id}:${quiz.revision}`].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
  return wrong[seed % wrong.length].id;
}

export function gradeQuizAnswer(quiz: QuizCardObject, optionId: string): boolean {
  if (!quiz.options.some((option) => option.id === optionId)) throw new Error(`Option ${optionId} is not part of quiz ${quiz.id}`);
  return optionId === quiz.correctOptionId;
}

const sameVersion = (quiz: QuizCardObject) => (attempt: QuizAttemptRecord) => attempt.quizId === quiz.id && attempt.quizRevision === quiz.revision;

export function createQuizAttempt(
  quiz: QuizCardObject,
  pageId: string,
  optionId: string,
  previous: readonly QuizAttemptRecord[],
  answeredAt: number,
  id: string,
  assistance?: QuizAssistance,
): QuizAttemptRecord {
  return {
    id,
    pageId,
    quizId: quiz.id,
    quizRevision: quiz.revision,
    chosenOptionId: optionId,
    correct: gradeQuizAnswer(quiz, optionId),
    sequence: previous.filter(sameVersion(quiz)).length + 1,
    answeredAt,
    ...(assistance ? { assistance } : {}),
  };
}

export type QuizAttemptSummary = {
  /** Attempts on the question as it is now. */
  attempts: number;
  /** Whether the first answer to this version was right; undefined before any answer. */
  firstTryCorrect?: boolean;
  /** Help seen before the first answer, which qualifies what that answer shows. */
  firstTryAssistance?: QuizAssistance;
  /** Answers given before the question was last edited, which say nothing about this version. */
  earlierVersionAttempts: number;
  lastAnsweredAt?: number;
};

/**
 * Plain counts, not a mastery score: after the first answer the rationale is
 * visible, so a later correct retry is not independent evidence of learning
 * and is reported separately from the first try.
 */
export function summarizeQuizAttempts(quiz: QuizCardObject, attempts: readonly QuizAttemptRecord[]): QuizAttemptSummary {
  const forQuiz = attempts.filter((attempt) => attempt.quizId === quiz.id);
  const current = forQuiz.filter(sameVersion(quiz)).sort((left, right) => left.sequence - right.sequence);
  return {
    attempts: current.length,
    firstTryCorrect: current[0]?.correct,
    ...(current[0]?.assistance ? { firstTryAssistance: current[0].assistance } : {}),
    earlierVersionAttempts: forQuiz.length - current.length,
    lastAnsweredAt: forQuiz.reduce<number | undefined>((latest, attempt) => (latest === undefined || attempt.answeredAt > latest ? attempt.answeredAt : latest), undefined),
  };
}

export function describeQuizAttempts(summary: QuizAttemptSummary): string | undefined {
  const parts: string[] = [];
  if (summary.attempts > 0) {
    // An answer given after the key was shown is practice, not evidence, so it gets no right/wrong label.
    parts.push(summary.firstTryAssistance === "revealed"
      ? "Answered after seeing the answer"
      : `First try ${summary.firstTryCorrect ? "correct" : "incorrect"}${summary.firstTryAssistance === "hint" ? " with a hint" : ""}`);
    if (summary.attempts > 1) parts.push(`${summary.attempts - 1} ${summary.attempts === 2 ? "retry" : "retries"}`);
  }
  if (summary.earlierVersionAttempts > 0) {
    parts.push(`${summary.earlierVersionAttempts} answer${summary.earlierVersionAttempts === 1 ? "" : "s"} to an earlier version`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
