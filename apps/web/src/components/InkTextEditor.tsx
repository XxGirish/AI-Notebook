import { useState, type FormEvent } from "react";
import type { InkTextObject } from "../domain/notebook";

type Props = {
  object: InkTextObject;
  onCancel: () => void;
  onSave: (text: string) => void;
  onRestoreInk: () => void;
};

export function InkTextEditor({ object, onCancel, onSave, onRestoreInk }: Props) {
  const [text, setText] = useState(object.text);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onSave(text);
  };

  return (
    <aside className="diagram-label-editor" aria-label="Edit converted handwriting">
      <form onSubmit={submit}>
        <label>
          <span>Converted text</span>
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={500} required autoFocus />
        </label>
        <div className="diagram-label-editor__actions">
          <button type="button" onClick={onRestoreInk} title="Replace this text with the original pen strokes">Back to handwriting</button>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save text</button>
        </div>
      </form>
    </aside>
  );
}
