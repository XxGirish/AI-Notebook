import { collectDiagrams, diagramAdapter } from "./diagramAdapter";
import { isLearningCardObject, learningObjectAdapter } from "./learningObjectAdapters";
import type { NotebookObject } from "./notebook";

export type LinearReadingItem = { id: string; text: string };

export function buildLinearReadingItems(objects: NotebookObject[]): LinearReadingItem[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const diagrams = collectDiagrams(objects);
  const diagramMemberIds = new Set(diagrams.flatMap((diagram) => [...diagram.nodes, ...diagram.connectors].map((object) => object.id)));

  const readable: Array<LinearReadingItem & { x: number; y: number }> = diagrams.map((diagram) => {
    const bounds = diagramAdapter.measure(diagram);
    return { id: diagram.id, text: diagramAdapter.toPlainText(diagram), x: bounds.x, y: bounds.y };
  });

  for (const object of objects) {
    if (diagramMemberIds.has(object.id)) continue;
    if (isLearningCardObject(object)) {
      readable.push({ id: object.id, text: learningObjectAdapter.toPlainText(object), x: object.x, y: object.y });
    } else if (object.kind === "connector") {
      // Connections involving cards, shapes, or images are not diagram edges.
      const from = byId.get(object.fromId);
      const to = byId.get(object.toId);
      const x = from && to ? Math.min(from.x, to.x) : 0;
      const y = from && to ? Math.min(from.y, to.y) : 0;
      readable.push({ id: object.id, text: `Connection from ${readableName(from, object.fromId)} to ${readableName(to, object.toId)}${object.label ? `: ${object.label}` : ""}`, x, y });
    } else if (object.kind === "ink-text" || object.kind === "text") {
      readable.push({ id: object.id, text: object.text, x: object.x, y: object.y });
    } else if (object.kind === "image") {
      readable.push({ id: object.id, text: `Image: ${object.name}`, x: object.x, y: object.y });
    }
  }

  return readable
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
    .map(({ id, text }) => ({ id, text }));
}

function readableName(object: NotebookObject | undefined, fallback: string) {
  if (!object) return fallback;
  if (object.kind === "graph-node") return object.label;
  if (object.kind === "text-card" || object.kind === "equation-card") return object.title;
  if (object.kind === "quiz-card") return "quiz";
  if (object.kind === "image") return object.name;
  if (object.kind === "ink-text" || object.kind === "text") return object.text;
  return object.kind;
}
