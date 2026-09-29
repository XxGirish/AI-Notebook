import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  EquationCardObject,
  QuizOption,
  QuizCardObject,
  TextCardObject,
} from "../domain/notebook";
import { learningObjectAdapter } from "../domain/learningObjectAdapters";
import { renderEquation } from "./equationRender";

type Position = { x: number; y: number };
type Size = { width: number; height: number };

type Props = {
  object: TextCardObject | EquationCardObject | QuizCardObject;
  position: Position;
  size: Size;
  cameraScale: number;
  selected: boolean;
  resizable: boolean;
  readOnly: boolean;
  onSelect: (additive: boolean) => void;
  onMove: (position: Position) => void;
  onMoveEnd: (position: Position) => void;
  onResize: (size: Size) => void;
  onResizeEnd: (size: Size) => void;
  onEditText: (title: string, body: string) => void;
  onEditEquation: (title: string, latex: string) => void;
  onEditQuiz: (prompt: string, options: QuizOption[], correctOptionId: string, rationale: string) => void;
  /** Called with the chosen option when a quiz is answered, so the attempt can be recorded. */
  onAnswerQuiz?: (optionId: string) => void;
  /** A short account of earlier answers to this quiz, if any. */
  attemptHistory?: string;
  attemptError?: string;
};

export function LearningCard({ object, position, size, cameraScale, selected, resizable, readOnly, onSelect, onMove, onMoveEnd, onResize, onResizeEnd, onEditText, onEditEquation, onEditQuiz, onAnswerQuiz, attemptHistory, attemptError }: Props) {
  const [answer, setAnswer] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(object.kind === "text-card" || object.kind === "equation-card" ? object.title : "");
  const [draftBody, setDraftBody] = useState(object.kind === "text-card" ? object.body : "");
  const [draftLatex, setDraftLatex] = useState(object.kind === "equation-card" ? object.latex : "");
  const [draftPrompt, setDraftPrompt] = useState(object.kind === "quiz-card" ? object.prompt : "");
  const [draftOptions, setDraftOptions] = useState<QuizOption[]>(object.kind === "quiz-card" ? object.options : []);
  const [draftCorrectOptionId, setDraftCorrectOptionId] = useState(object.kind === "quiz-card" ? object.correctOptionId : "");
  const [draftRationale, setDraftRationale] = useState(object.kind === "quiz-card" ? object.rationale : "");
  const renderModel = useMemo(() => learningObjectAdapter.render(object), [object]);
  const renderedEquation = useMemo(
    () => renderModel.kind === "equation" ? renderEquation(renderModel.latex) : undefined,
    [renderModel],
  );

  useEffect(() => {
    if (readOnly) setEditing(false);
  }, [readOnly]);

  useEffect(() => {
    if (editing) return;
    if (object.kind === "text-card") {
      setDraftTitle(object.title);
      setDraftBody(object.body);
    } else if (object.kind === "equation-card") {
      setDraftTitle(object.title);
      setDraftLatex(object.latex);
    } else {
      setDraftPrompt(object.prompt);
      setDraftOptions(object.options.map((option) => ({ ...option })));
      setDraftCorrectOptionId(object.correctOptionId);
      setDraftRationale(object.rationale);
    }
  }, [editing, object]);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (readOnly) return;
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
        disabled={readOnly}
      >
        <span aria-hidden="true">⠿</span> Move
      </button>

      {!editing && !readOnly && (
        <button type="button" className="learning-card__edit" onClick={() => setEditing(true)}>Edit</button>
      )}

      {object.kind === "text-card" && renderModel.kind === "text" && (
        editing ? (
          <form
            className="note-editor"
            onSubmit={(event) => {
              event.preventDefault();
              onEditText(draftTitle.trim() || "Untitled note", draftBody.trim());
              setEditing(false);
            }}
          >
            <input aria-label="Note title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus maxLength={160} />
            <textarea aria-label="Note body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} maxLength={8_000} />
            <div className="note-editor__actions">
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        ) : (
          <>
            <h3>{renderModel.title}</h3>
            <p>{renderModel.body}</p>
          </>
        )
      )}

      {object.kind === "equation-card" && renderModel.kind === "equation" && (
        editing ? (
          <form
            className="note-editor"
            onSubmit={(event) => {
              event.preventDefault();
              onEditEquation(draftTitle.trim() || "Untitled equation", draftLatex.trim());
              setEditing(false);
            }}
          >
            <input aria-label="Equation title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} autoFocus required maxLength={160} />
            <textarea aria-label="LaTeX equation" value={draftLatex} onChange={(event) => setDraftLatex(event.target.value)} required maxLength={2_000} />
            <div className="note-editor__actions">
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        ) : (
          <>
            <h3>{renderModel.title}</h3>
            {renderedEquation?.valid ? (
              <div className="equation" aria-label={renderModel.latex} dangerouslySetInnerHTML={{ __html: renderedEquation.html }} />
            ) : (
              <div className="equation equation--invalid" role="status">
                <span>{renderedEquation?.message}</span>
                <code>{renderModel.latex}</code>
              </div>
            )}
          </>
        )
      )}

      {object.kind === "quiz-card" && renderModel.kind === "quiz" && (
        editing ? (
          <form
            className="note-editor quiz-editor"
            onSubmit={(event) => {
              event.preventDefault();
              onEditQuiz(
                draftPrompt.trim(),
                draftOptions.map((option) => ({ ...option, label: option.label.trim() })),
                draftCorrectOptionId,
                draftRationale.trim(),
              );
              setAnswer(undefined);
              setEditing(false);
            }}
          >
            <textarea aria-label="Quiz question" value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} autoFocus required maxLength={1_500} />
            <fieldset>
              <legend>Answer choices and correct answer</legend>
              {draftOptions.map((option, index) => (
                <label key={option.id} className="quiz-editor__option">
                  <input
                    type="radio"
                    name={`correct-${object.id}`}
                    checked={draftCorrectOptionId === option.id}
                    onChange={() => setDraftCorrectOptionId(option.id)}
                    aria-label={`Mark option ${index + 1} correct`}
                  />
                  <input
                    aria-label={`Option ${index + 1}`}
                    value={option.label}
                    onChange={(event) => setDraftOptions((current) => current.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item))}
                    required
                    maxLength={240}
                  />
                </label>
              ))}
            </fieldset>
            <textarea aria-label="Answer rationale" value={draftRationale} onChange={(event) => setDraftRationale(event.target.value)} required maxLength={3_000} />
            <div className="note-editor__actions">
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        ) : <>
          <p className="quiz-label">Quick check</p>
          <h3>{renderModel.prompt}</h3>
          <div className="quiz-options" role="group" aria-label="Answer choices">
            {renderModel.options.map((option) => {
              const isChosen = answer === option.id;
              const isCorrect = option.id === renderModel.correctOptionId;
              const state = isChosen ? (isCorrect ? "correct" : "incorrect") : undefined;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-state={state}
                  aria-pressed={isChosen}
                  onClick={() => {
                    setAnswer(option.id);
                    onAnswerQuiz?.(option.id);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {answer && (
            <p className="quiz-feedback" role="status">
              {answer === renderModel.correctOptionId ? "Correct. " : "Not quite. "}
              {renderModel.rationale}
            </p>
          )}
          {attemptHistory && <p className="quiz-history">{attemptHistory}</p>}
          {attemptError && <p className="quiz-history quiz-history--error" role="alert">{attemptError}</p>}
        </>
      )}

      {selected && resizable && (
        <button type="button" className="learning-card__resize" onPointerDown={beginResize} aria-label={`Resize ${object.kind}`} title="Resize" />
      )}
    </article>
  );
}
