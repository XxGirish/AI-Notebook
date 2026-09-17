import { isLearningCardObject, learningObjectAdapter } from "./learningObjectAdapters";
import type { NotebookObject } from "./notebook";

export type LinearReadingItem = { id: string; text: string };

export function buildLinearReadingItems(objects: NotebookObject[]): LinearReadingItem[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const readable = objects.flatMap((object): Array<LinearReadingItem & { x: number; y: number }> => {
    if (isLearningCardObject(object)) {
      return [{ id: object.id, text: learningObjectAdapter.toPlainText(object), x: object.x, y: object.y }];
    }
    if (object.kind === "graph-node") {
      return [{ id: object.id, text: `Diagram node: ${object.label}`, x: object.x, y: object.y }];
    }
    if (object.kind === "connector") {
      const from = byId.get(object.fromId);
      const to = byId.get(object.toId);
      const fromLabel = from?.kind === "graph-node" ? from.label : object.fromId;
      const toLabel = to?.kind === "graph-node" ? to.label : object.toId;
      const x = from && to ? Math.min(from.x, to.x) : 0;
      const y = from && to ? Math.min(from.y, to.y) : 0;
      return [{ id: object.id, text: `Connection from ${fromLabel} to ${toLabel}${object.label ? `: ${object.label}` : ""}`, x, y }];
    }
    if (object.kind === "image") {
      return [{ id: object.id, text: `Image: ${object.name}`, x: object.x, y: object.y }];
    }
    return [];
  });

  return readable
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id))
    .map(({ id, text }) => ({ id, text }));
}
