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
};

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
  };
}

export type QuizAttemptSummary = {
  /** Attempts on the question as it is now. */
  attempts: number;
  /** Whether the first answer to this version was right; undefined before any answer. */
  firstTryCorrect?: boolean;
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
    earlierVersionAttempts: forQuiz.length - current.length,
    lastAnsweredAt: forQuiz.reduce<number | undefined>((latest, attempt) => (latest === undefined || attempt.answeredAt > latest ? attempt.answeredAt : latest), undefined),
  };
}

export function describeQuizAttempts(summary: QuizAttemptSummary): string | undefined {
  const parts: string[] = [];
  if (summary.attempts > 0) {
    parts.push(`First try ${summary.firstTryCorrect ? "correct" : "incorrect"}`);
    if (summary.attempts > 1) parts.push(`${summary.attempts - 1} ${summary.attempts === 2 ? "retry" : "retries"}`);
  }
  if (summary.earlierVersionAttempts > 0) {
    parts.push(`${summary.earlierVersionAttempts} answer${summary.earlierVersionAttempts === 1 ? "" : "s"} to an earlier version`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
