import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { MAX_TEXT_LENGTH, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_PADDING } from "../canvas/textBox";

type Props = {
  box: { x: number; y: number; width: number; height: number };
  fontSize: number;
  color: string;
  initialText: string;
  /** Pressing inside this element only ends the edit, so the press cannot also start something new. */
  canvasRef: RefObject<HTMLElement>;
  onCommit: (text: string) => void;
};

/**
 * Types directly on the canvas. It sits in world coordinates inside a layer
 * carrying the camera transform, and uses the same font metrics as the Konva
 * text it replaces, so the words do not move when editing starts or ends.
 * Every way of leaving (blur, Escape, Ctrl/⌘+Enter, pressing elsewhere) keeps
 * what was typed; Undo is how an edit is taken back.
 */
export function CanvasTextEditor({ box, fontSize, color, initialText, canvasRef, onCommit }: Props) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommitRef.current(textRef.current);
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // The box grows with its content while typing, like the committed text will.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(box.height, textarea.scrollHeight)}px`;
  }, [text, box.height, box.width, fontSize]);

  // A press on the canvas never focuses anything, so blur alone would miss it:
  // Konva prevents the default of pointer events on the stage.
  useEffect(() => {
    const finishOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && textareaRef.current?.contains(target)) return;
      if (target && canvasRef.current?.contains(target)) event.stopPropagation();
      commit();
    };
    window.addEventListener("pointerdown", finishOnOutsidePress, true);
    return () => window.removeEventListener("pointerdown", finishOnOutsidePress, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      className="canvas-text-editor"
      aria-label="Canvas text"
      value={text}
      maxLength={MAX_TEXT_LENGTH}
      spellCheck
      onChange={(event) => setText(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        minHeight: box.height,
        padding: TEXT_PADDING,
        fontSize,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT_FAMILY,
        color,
      }}
    />
  );
}
