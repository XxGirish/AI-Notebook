import { describe, expect, it } from "vitest";
import type { NotebookObject } from "../domain/notebook";
import { expandGroupedIds, groupObjects, translateObjectGroup, ungroupObjects } from "./groupMath";

const objects: NotebookObject[] = [
  { id: "a", revision: 1, kind: "shape", shape: "rectangle", fill: "#fff", stroke: "#000", x: 10, y: 20, width: 80, height: 50 },
  { id: "b", revision: 1, kind: "shape", shape: "ellipse", fill: "#fff", stroke: "#000", x: 150, y: 40, width: 80, height: 50 },
  { id: "edge", revision: 1, kind: "connector", fromId: "a", toId: "b", x: 0, y: 0, width: 0, height: 0 },
  { id: "outside", revision: 1, kind: "text-card", title: "Outside", body: "", x: 300, y: 50, width: 120, height: 90 },
];

describe("object grouping", () => {
  it("groups selected objects and their bound connector", () => {
    const grouped = groupObjects(objects, new Set(["a", "b"]), "group-1");
    expect(grouped.filter((object) => object.groupId === "group-1").map((object) => object.id)).toEqual(["a", "b", "edge"]);
    expect(expandGroupedIds(grouped, new Set(["a"]))).toEqual(new Set(["a", "b", "edge"]));
  });

  it("moves all visual members but keeps unrelated objects fixed", () => {
    const grouped = groupObjects(objects, new Set(["a", "b"]), "group-1");
    const moved = translateObjectGroup(grouped, "a", { x: 30, y: 50 });
    expect(moved.find((object) => object.id === "a")).toMatchObject({ x: 30, y: 50 });
    expect(moved.find((object) => object.id === "b")).toMatchObject({ x: 170, y: 70 });
    expect(moved.find((object) => object.id === "outside")).toMatchObject({ x: 300, y: 50 });
  });

  it("ungroups every member when one member is selected", () => {
    const grouped = groupObjects(objects, new Set(["a", "b"]), "group-1");
    expect(ungroupObjects(grouped, new Set(["a"])).every((object) => object.groupId === undefined)).toBe(true);
  });
});
