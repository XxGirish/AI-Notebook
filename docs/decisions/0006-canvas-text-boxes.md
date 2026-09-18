# 0006 — Typed text boxes on the canvas

Date: 2026-09-19
Status: accepted; verified with mouse and keyboard in the in-app browser, not yet on pen or touch devices

## Decision

A **Text** tool (shortcut `T`) lets the writer type directly on the canvas. It works like the Rectangle and Ellipse tools. Dragging sets the box width and a minimum height. A tap places a one-line box, 240 units wide, with the caret where the writer tapped. Typing happens in place, in a `<textarea>` inside a layer that carries the camera transform. That layer uses the same font, line height and padding as the Konva `Text` that renders the committed words, so the text does not move when editing starts or ends.

- Page schema 4 adds a `text` object: `text`, `fontSize` and `color`, plus the usual geometry. Text wraps to the box width. The stored height is the height the writer gave the box, or the height the text needs, whichever is larger, so text is never clipped. Older app code refuses schema-4 pages instead of misreading them. Pages from schema 3 or earlier cannot contain `text` objects.
- A new box enters the document only when its text is committed, as one undoable step. A box left empty never becomes an object. Clearing all the text from an existing box deletes it. An edit that changes nothing is not a history step.
- Editing ends on blur, Escape, Ctrl/⌘+Enter, or a press anywhere else. Pressing the canvas only ends the edit; it does not also start a new box or change the selection. Enter inserts a new line. Every exit keeps the text; Undo takes an edit back.
- To edit existing text, double-click or double-tap it, press Enter while it is selected, use the Edit text button, or tap it with the Text tool.
- Text size (Small 16, Medium 20, Large 28, Heading 40) applies to new text and to the selected text box. The bottom-right handle resizes a box, and the text rewraps. The handle cannot shrink a box so far that it hides text.
- Text boxes move, group, duplicate, lasso and delete like other objects. They appear in the linear reading view and in the static SVG export. The whole-stroke eraser does not remove them.

Layout rules live in `apps/web/src/canvas/textBox.ts`. The editor is `apps/web/src/components/CanvasTextEditor.tsx`.

## Limitations

- Styling is per box: one size and one color. There is no bold, italic, alignment or rich text.
- Static export estimates text width, because there is no canvas to measure with, so line breaks there can differ slightly from the canvas.
- Not yet checked on real tablets: on-screen keyboard behavior, and whether the canvas stays aligned when the keyboard resizes the viewport.
