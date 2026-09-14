import katex from "katex";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  EquationCardObject,
  QuizCardObject,
  TextCardObject,
} from "../domain/notebook";

type Position = { x: number; y: number };

type Props = {
  object: TextCardObject | EquationCardObject | QuizCardObject;
  position: Position;
  cameraScale: number;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (position: Position) => void;
  onMoveEnd: (position: Position) => void;
};

export function LearningCard({ object, position, cameraScale, selected, onSelect, onMove, onMoveEnd }: Props) {
  const [answer, setAnswer] = useState<string>();

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { pointerX: event.clientX, pointerY: event.clientY, ...position };
    const lastPointer = { x: event.clientX, y: event.clientY };

    const positionFromPointer = (x: number, y: number) => ({
      x: origin.x + (x - origin.pointerX) / cameraScale,
      y: origin.y + (y - origin.pointerY) / cameraScale,
    });

    const move = (moveEvent: PointerEvent) => {
      lastPointer.x = moveEvent.clientX;
      lastPointer.y = moveEvent.clientY;
      onMove(positionFromPointer(moveEvent.clientX, moveEvent.clientY));
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };

    const finish = () => {
      cleanup();
      onMoveEnd(positionFromPointer(lastPointer.x, lastPointer.y));
    };

    const cancel = () => {
      cleanup();
      onMove({ x: origin.x, y: origin.y });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  const style = {
    left: position.x,
    top: position.y,
    width: object.width,
    minHeight: object.height,
  };

  return (
    <article
      className={`learning-card learning-card--${object.kind}`}
      data-selected={selected}
      style={style}
      onPointerDown={(event) => onSelect(event.shiftKey)}
    >
      <button
        className="learning-card__handle"
        type="button"
        onPointerDown={beginDrag}
        aria-label={`Move ${object.kind}`}
      >
        <span aria-hidden="true">⠿</span> Move
      </button>

      {object.kind === "text-card" && (
        <>
          <h3>{object.title}</h3>
          <p>{object.body}</p>
        </>
      )}

      {object.kind === "equation-card" && (
        <>
          <h3>{object.title}</h3>
          <div
            className="equation"
            aria-label={object.latex}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(object.latex, {
                throwOnError: false,
                trust: false,
                strict: "warn",
              }),
            }}
          />
        </>
      )}

      {object.kind === "quiz-card" && (
        <>
          <p className="quiz-label">Quick check</p>
          <h3>{object.prompt}</h3>
          <div className="quiz-options" role="group" aria-label="Answer choices">
            {object.options.map((option) => {
              const isChosen = answer === option.id;
              const isCorrect = option.id === object.correctOptionId;
              const state = isChosen ? (isCorrect ? "correct" : "incorrect") : undefined;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-state={state}
                  aria-pressed={isChosen}
                  onClick={() => setAnswer(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {answer && (
            <p className="quiz-feedback" role="status">
              {answer === object.correctOptionId ? "Correct. " : "Not quite. "}
              {object.rationale}
            </p>
          )}
        </>
      )}
    </article>
  );
}
