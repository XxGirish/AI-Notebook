import katex from "katex";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  EquationCardObject,
  QuizCardObject,
  TextCardObject,
} from "../domain/notebook";

type Position = { x: number; y: number };
type Size = { width: number; height: number };

type Props = {
  object: TextCardObject | EquationCardObject | QuizCardObject;
  position: Position;
  size: Size;
  cameraScale: number;
  selected: boolean;
  resizable: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (position: Position) => void;
  onMoveEnd: (position: Position) => void;
  onResize: (size: Size) => void;
  onResizeEnd: (size: Size) => void;
  onEditText: (title: string, body: string) => void;
};

export function LearningCard({ object, position, size, cameraScale, selected, resizable, onSelect, onMove, onMoveEnd, onResize, onResizeEnd, onEditText }: Props) {
  const [answer, setAnswer] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(object.kind === "text-card" ? object.title : "");
  const [draftBody, setDraftBody] = useState(object.kind === "text-card" ? object.body : "");

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

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { pointerX: event.clientX, pointerY: event.clientY, ...size };
    const lastPointer = { x: event.clientX, y: event.clientY };
    const sizeFromPointer = (x: number, y: number) => ({
      width: Math.max(190, origin.width + (x - origin.pointerX) / cameraScale),
      height: Math.max(110, origin.height + (y - origin.pointerY) / cameraScale),
    });
    const move = (moveEvent: PointerEvent) => {
      lastPointer.x = moveEvent.clientX;
      lastPointer.y = moveEvent.clientY;
      onResize(sizeFromPointer(moveEvent.clientX, moveEvent.clientY));
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    const finish = () => {
      cleanup();
      onResizeEnd(sizeFromPointer(lastPointer.x, lastPointer.y));
    };
    const cancel = () => {
      cleanup();
      onResize({ width: origin.width, height: origin.height });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  const style = {
    left: position.x,
    top: position.y,
    width: size.width,
    minHeight: size.height,
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

      {object.kind === "text-card" && !editing && (
        <button type="button" className="learning-card__edit" onClick={() => setEditing(true)}>Edit</button>
      )}

      {object.kind === "text-card" && (
        editing ? (
          <form
            className="note-editor"
            onSubmit={(event) => {
              event.preventDefault();
              onEditText(draftTitle.trim() || "Untitled note", draftBody.trim());
              setEditing(false);
            }}
          >
            <input aria-label="Note title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus />
            <textarea aria-label="Note body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
            <div className="note-editor__actions">
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        ) : (
          <>
            <h3>{object.title}</h3>
            <p>{object.body}</p>
          </>
        )
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

      {selected && resizable && (
        <button type="button" className="learning-card__resize" onPointerDown={beginResize} aria-label={`Resize ${object.kind}`} title="Resize" />
      )}
    </article>
  );
}
