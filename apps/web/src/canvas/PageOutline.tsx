import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { describeRecency, QUIZ_REVIEW_LABELS, summarizeReview, type QuizReviewItem } from "../domain/quizReview";

type Props = {
  readingItems: Array<{ id: string; text: string }>;
  quizReview: QuizReviewItem[];
  onGoTo: (id: string) => void;
  onClose: () => void;
};

/**
 * The page as plain, ordered text plus the quiz review: the accessible way to
 * read a page whose canvas pixels a screen reader cannot. It floats over the
 * canvas instead of sitting above it, so it costs no space until opened.
 */
export function PageOutline({ readingItems, quizReview, onGoTo, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={panelRef}
      className="page-outline canvas-chrome"
      aria-label="Page outline"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="page-outline__header">
        <h2>Page outline</h2>
        <button type="button" className="icon-button" aria-label="Close the page outline" title="Close (Esc)" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {quizReview.length > 0 && (
        <section className="quiz-review" aria-label="Quiz review">
          <h3>Quiz review · {summarizeReview(quizReview)}</h3>
          <ol>
            {quizReview.map((item) => (
              <li key={item.quizId} data-status={item.status}>
                <span className="quiz-review__status">{QUIZ_REVIEW_LABELS[item.status]}</span>
                <span className="quiz-review__prompt">{item.prompt}</span>
                <span className="quiz-review__meta">
                  {item.lastAnsweredAt !== undefined
                    ? `${item.attempts > 0 ? `${item.attempts} answer${item.attempts === 1 ? "" : "s"}, ` : ""}last ${describeRecency(item.lastAnsweredAt, Date.now())}`
                    : ""}
                </span>
                <button type="button" onClick={() => onGoTo(item.quizId)}>Go to</button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="linear-reading-view" aria-label="Reading view">
        <h3>Reading view</h3>
        {readingItems.length > 0 ? (
          <ol>{readingItems.map((item) => <li key={item.id}>{item.text}</li>)}</ol>
        ) : (
          <p>No readable learning objects on this page yet.</p>
        )}
      </section>
    </aside>
  );
}
