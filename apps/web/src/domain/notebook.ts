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

export type StrokeObject = ObjectBase & {
  kind: "stroke";
  tool: "pen" | "highlighter";
  color: string;
  size: number;
  points: PointSample[];
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
  | TextCardObject
  | EquationCardObject
  | GraphNodeObject
  | ShapeObject
  | ConnectorObject
  | QuizCardObject;

export type NotebookFixture = {
  schemaVersion: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  objects: NotebookObject[];
};

export function validateFixture(fixture: NotebookFixture): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const object of fixture.objects) {
    if (ids.has(object.id)) errors.push(`Duplicate object id: ${object.id}`);
    ids.add(object.id);
  }

  for (const object of fixture.objects) {
    if (object.kind === "connector") {
      if (!ids.has(object.fromId)) errors.push(`Missing connector source: ${object.fromId}`);
      if (!ids.has(object.toId)) errors.push(`Missing connector target: ${object.toId}`);
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
