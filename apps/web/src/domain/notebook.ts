import type { PaperStyle } from "./paper";
export type PointSample = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

type ObjectBase = {
  id: string;
  revision: number;
  groupId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GeneratedContentProvenance = {
  requestId: string;
  intent: "teach_section" | "explain_selection" | "create_diagram" | "create_equation" | "create_quiz" | "chat_answer";
  provider: string;
  model: string;
  configurationId: string;
  proposalSchemaVersion: number;
  /**
   * Everything sent as context. `selected` marks what the writer chose, as
   * opposed to nearby context; `contentHash` fingerprints its meaning when it
   * was sent, so a later edit (but not a move) can mark the result stale.
   */
  sources: Array<{ id: string; revision: number; contentHash?: string; selected?: boolean }>;
};

export type AiTransactionRecord = GeneratedContentProvenance & {
  transactionId: string;
  committedAt: number;
  generatedObjectIds: string[];
  updatedObjectIds: string[];
};

export type StrokeObject = ObjectBase & {
  kind: "stroke";
  tool: "pen" | "highlighter";
  color: string;
  size: number;
  points: PointSample[];
};

/**
 * Handwriting converted to typed text by the earlier recognizing Pen Pro. The original
 * strokes travel with the object so the user can always return to their ink,
 * even after reload or transfer, when recognition was wrong.
 */
export type InkTextObject = ObjectBase & {
  kind: "ink-text";
  text: string;
  fontSize: number;
  color: string;
  recognizedText: string;
  recognizer: string;
  sourceStrokes: StrokeObject[];
};

/**
 * Typed text placed directly on the canvas with the Text tool. The writer sets
 * the box width; text wraps inside it and the box grows downward to fit.
 */
export type TextObject = ObjectBase & {
  kind: "text";
  text: string;
  fontSize: number;
  color: string;
};

export type TextCardObject = ObjectBase & {
  kind: "text-card";
  title: string;
  body: string;
};

export type EquationCardObject = ObjectBase & {
  kind: "equation-card";
  title: string;
  latex: string;
};

export type GraphNodeObject = ObjectBase & {
  kind: "graph-node";
  label: string;
};

export type ShapeObject = ObjectBase & {
  kind: "shape";
  shape: "rectangle" | "ellipse";
  fill: string;
  stroke: string;
};

export type ImageObject = ObjectBase & {
  kind: "image";
  assetHash: string;
  mimeType: string;
  name: string;
};

export type ConnectorObject = ObjectBase & {
  kind: "connector";
  fromId: string;
  toId: string;
  label?: string;
};

export type QuizOption = {
  id: string;
  label: string;
};

export type QuizCardObject = ObjectBase & {
  kind: "quiz-card";
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  rationale: string;
};

export type NotebookObject =
  | StrokeObject
  | InkTextObject
  | TextObject
  | TextCardObject
  | EquationCardObject
  | GraphNodeObject
  | ShapeObject
  | ImageObject
  | ConnectorObject
  | QuizCardObject;

export type NotebookFixture = {
  schemaVersion: 4;
  id: string;
  title: string;
  width: number;
  height: number;
  /** An optional sheet drawn behind the page's content; absent means none. */
  paper?: PaperStyle;
  objects: NotebookObject[];
  aiTransactions: AiTransactionRecord[];
};

export function validateFixture(fixture: NotebookFixture): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const transactionIds = new Set<string>();

  for (const object of fixture.objects) {
    if (ids.has(object.id)) errors.push(`Duplicate object id: ${object.id}`);
    ids.add(object.id);
  }

  for (const transaction of fixture.aiTransactions) {
    if (transactionIds.has(transaction.transactionId)) errors.push(`Duplicate AI transaction id: ${transaction.transactionId}`);
    transactionIds.add(transaction.transactionId);
  }

  for (const object of fixture.objects) {
    if (object.kind === "connector") {
      if (!ids.has(object.fromId)) errors.push(`Missing connector source: ${object.fromId}`);
      if (!ids.has(object.toId)) errors.push(`Missing connector target: ${object.toId}`);
    }

    if (object.kind === "image" && !/^[a-f0-9]{64}$/.test(object.assetHash)) {
      errors.push(`Image ${object.id} has an invalid asset hash`);
    }

    if (
      object.kind === "quiz-card" &&
      !object.options.some((option) => option.id === object.correctOptionId)
    ) {
      errors.push(`Quiz ${object.id} has an invalid answer key`);
    }
  }

  return errors;
}
