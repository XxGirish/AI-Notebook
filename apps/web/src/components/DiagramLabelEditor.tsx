import { useState, type FormEvent } from "react";
import type { ConnectorObject, GraphNodeObject } from "../domain/notebook";

type Props = {
  object: GraphNodeObject | ConnectorObject;
  onCancel: () => void;
  onSave: (label: string) => void;
};

export function DiagramLabelEditor({ object, onCancel, onSave }: Props) {
  const [label, setLabel] = useState(object.label ?? "");
  const isNode = object.kind === "graph-node";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = label.trim();
    if (isNode && !normalized) return;
    onSave(normalized);
  };

  return (
    <aside className="diagram-label-editor" aria-label={`Edit ${isNode ? "diagram node" : "connector"} label`}>
      <form onSubmit={submit}>
        <label>
          <span>{isNode ? "Node label" : "Connector label"}</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={isNode ? 240 : 160}
            required={isNode}
            autoFocus
          />
        </label>
        <div className="diagram-label-editor__actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save label</button>
        </div>
      </form>
    </aside>
  );
}
