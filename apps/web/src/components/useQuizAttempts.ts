import { useCallback, useEffect, useRef, useState } from "react";
import type { QuizCardObject } from "../domain/notebook";
import { createQuizAttempt, type QuizAssistance, type QuizAttemptRecord } from "../domain/quizAttempts";
import { addQuizAttempt, loadQuizAttempts } from "../persistence/notebookDatabase";

export type QuizAttemptFailure = { quizId: string; message: string };

/**
 * The quiz attempts of one page. Grading is local and immediate; the record is
 * written in the background and taken back out of the list if the write fails,
 * so the card never claims an answer was kept when it was not.
 */
export function useQuizAttempts(pageId: string) {
  const [attempts, setAttempts] = useState<QuizAttemptRecord[]>([]);
  const [failure, setFailure] = useState<QuizAttemptFailure>();
  const attemptsRef = useRef<QuizAttemptRecord[]>([]);

  const publish = (next: QuizAttemptRecord[]) => {
    attemptsRef.current = next;
    setAttempts(next);
  };

  useEffect(() => {
    let live = true;
    publish([]);
    loadQuizAttempts(pageId).then(
      (stored) => {
        if (!live) return;
        // Keep any answer given while the stored ones were still loading.
        const storedIds = new Set(stored.map((attempt) => attempt.id));
        publish([...stored, ...attemptsRef.current.filter((attempt) => !storedIds.has(attempt.id))]);
      },
      () => {
        if (live) setFailure({ quizId: "", message: "Earlier answers on this page could not be read." });
      },
    );
    return () => {
      live = false;
    };
  }, [pageId]);

  const recordAnswer = useCallback(async (quiz: QuizCardObject, optionId: string, assistance?: QuizAssistance) => {
    const attempt = createQuizAttempt(quiz, pageId, optionId, attemptsRef.current, Date.now(), `attempt-${crypto.randomUUID()}`, assistance);
    publish([...attemptsRef.current, attempt]);
    setFailure((current) => (current?.quizId === quiz.id ? undefined : current));
    try {
      await addQuizAttempt(attempt);
    } catch {
      publish(attemptsRef.current.filter((candidate) => candidate.id !== attempt.id));
      setFailure({ quizId: quiz.id, message: "This answer was graded but could not be saved to this browser's storage." });
    }
  }, [pageId]);

  return { attempts, failure, recordAnswer };
}
