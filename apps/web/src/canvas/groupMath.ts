import type { NotebookObject } from "../domain/notebook";

type Position = { x: number; y: number };

export function expandGroupedIds(objects: NotebookObject[], ids: ReadonlySet<string>): Set<string> {
  const groupIds = new Set(
    objects.filter((object) => ids.has(object.id) && object.groupId).map((object) => object.groupId!),
  );
  const expanded = new Set(ids);
  for (const object of objects) {
    if (object.groupId && groupIds.has(object.groupId)) expanded.add(object.id);
  }
  return expanded;
}

export function groupObjects(objects: NotebookObject[], ids: ReadonlySet<string>, groupId: string): NotebookObject[] {
  const groupedIds = new Set(ids);
  for (const object of objects) {
    if (object.kind === "connector" && ids.has(object.fromId) && ids.has(object.toId)) groupedIds.add(object.id);
  }
  return objects.map((object) => groupedIds.has(object.id)
    ? { ...object, groupId, revision: object.revision + 1 }
    : object);
}

export function ungroupObjects(objects: NotebookObject[], ids: ReadonlySet<string>): NotebookObject[] {
  const groupIds = new Set(
    objects.filter((object) => ids.has(object.id) && object.groupId).map((object) => object.groupId!),
  );
  return objects.map((object) => object.groupId && groupIds.has(object.groupId)
    ? { ...object, groupId: undefined, revision: object.revision + 1 }
    : object);
}

export function translateObjectGroup(objects: NotebookObject[], anchorId: string, position: Position): NotebookObject[] {
  const anchor = objects.find((object) => object.id === anchorId);
  if (!anchor) return objects;
  const ids = anchor.groupId
    ? new Set(objects.filter((object) => object.groupId === anchor.groupId).map((object) => object.id))
    : new Set([anchorId]);
  const delta = { x: position.x - anchor.x, y: position.y - anchor.y };

  return objects.map((object) => {
    if (!ids.has(object.id) || object.kind === "connector") return object;
    if (object.kind === "stroke") {
      return {
        ...object,
        x: object.x + delta.x,
        y: object.y + delta.y,
        revision: object.revision + 1,
        points: object.points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y })),
      };
    }
    return { ...object, x: object.x + delta.x, y: object.y + delta.y, revision: object.revision + 1 };
  });
}
