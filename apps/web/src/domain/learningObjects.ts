import type { ConnectorObject, GraphNodeObject, NotebookObject, QuizOption } from "./notebook";

export type EditableDiagramObject = GraphNodeObject | ConnectorObject;

export type LearningObjectEdit =
  | { kind: "text-card"; title: string; body: string }
  | { kind: "equation-card"; title: string; latex: string }
  | { kind: "graph-node"; label: string }
  | { kind: "connector"; label?: string }
  | {
    kind: "quiz-card";
    prompt: string;
    options: QuizOption[];
    correctOptionId: string;
    rationale: string;
  };

const hasLength = (value: string, minimum: number, maximum: number) => value.length >= minimum && value.length <= maximum;

export function getFocusedDiagramObject(
  objects: NotebookObject[],
  selectedIds: ReadonlySet<string>,
  focusedObjectId?: string,
): EditableDiagramObject | undefined {
  if (!focusedObjectId || !selectedIds.has(focusedObjectId)) return undefined;
  const focused = objects.find((object) => object.id === focusedObjectId);
  return focused?.kind === "graph-node" || focused?.kind === "connector" ? focused : undefined;
}

export function applyLearningObjectEdit(
  objects: NotebookObject[],
  id: string,
  edit: LearningObjectEdit,
): NotebookObject[] {
  const index = objects.findIndex((object) => object.id === id);
  if (index < 0) return objects;

  const current = objects[index];
  if (current.kind !== edit.kind) return objects;

  let replacement: NotebookObject;
  if (current.kind === "text-card" && edit.kind === "text-card") {
    if (!hasLength(edit.title, 1, 160) || !hasLength(edit.body, 0, 8_000)) return objects;
    replacement = { ...current, title: edit.title, body: edit.body, revision: current.revision + 1 };
  } else if (current.kind === "equation-card" && edit.kind === "equation-card") {
    if (!hasLength(edit.title, 1, 160) || !hasLength(edit.latex, 1, 2_000)) return objects;
    replacement = { ...current, title: edit.title, latex: edit.latex, revision: current.revision + 1 };
  } else if (current.kind === "graph-node" && edit.kind === "graph-node") {
    if (!hasLength(edit.label, 1, 240)) return objects;
    replacement = { ...current, label: edit.label, revision: current.revision + 1 };
  } else if (current.kind === "connector" && edit.kind === "connector") {
    if (edit.label !== undefined && !hasLength(edit.label, 1, 160)) return objects;
    if (edit.label === undefined) {
      const { label: _removedLabel, ...withoutLabel } = current;
      replacement = { ...withoutLabel, revision: current.revision + 1 };
    } else {
      replacement = { ...current, label: edit.label, revision: current.revision + 1 };
    }
  } else if (current.kind === "quiz-card" && edit.kind === "quiz-card") {
    const optionIds = new Set(edit.options.map((option) => option.id));
    if (edit.options.length < 2 || edit.options.length > 6 || optionIds.size !== edit.options.length) return objects;
    if (!optionIds.has(edit.correctOptionId)) return objects;
    if (!hasLength(edit.prompt, 1, 1_500) || !hasLength(edit.rationale, 1, 3_000)) return objects;
    if (edit.options.some((option) => !hasLength(option.id, 1, 200) || !hasLength(option.label, 1, 240))) return objects;
    replacement = {
      ...current,
      prompt: edit.prompt,
      options: edit.options.map((option) => ({ ...option })),
      correctOptionId: edit.correctOptionId,
      rationale: edit.rationale,
      revision: current.revision + 1,
    };
  } else {
    return objects;
  }

  const next = [...objects];
  next[index] = replacement;
  return next;
}
