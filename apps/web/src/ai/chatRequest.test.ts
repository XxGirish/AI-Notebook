import { describe, expect, it } from "vitest";
import type { ConnectorObject, GraphNodeObject, TextCardObject } from "../domain/notebook";
import { citedPageSources } from "./chatRequest";

const note: TextCardObject = { id: "note", revision: 3, kind: "text-card", x: 0, y: 0, width: 200, height: 100, title: "Momentum", body: "p = mv" };
const node = (id: string): GraphNodeObject => ({ id, revision: 2, kind: "graph-node", x: 400, y: id === "node-a" ? 0 : 200, width: 120, height: 60, label: id });
const edge: ConnectorObject = { id: "edge", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "node-a", toId: "node-b" };
const page = { id: "page-1", objects: [note, node("node-a"), node("node-b"), edge] };

describe("sources of a chat answer added to a page", () => {
  it("records the page's cited notes and expands a diagram citation to its nodes", () => {
    const sources = citedPageSources([
      { id: "N1", origin: "Notebook page", locator: "Note", text: "p = mv", pageId: "page-1", objectId: "note" },
      { id: "N2", origin: "Notebook page", locator: "Diagram", text: "node-a", pageId: "page-1", objectId: "diagram:node-a" },
      { id: "N3", origin: "Notebook page", locator: "Note", text: "again", pageId: "page-1", objectId: "note" },
    ], page);
    expect(sources).toEqual([{ id: "note", revision: 3 }, { id: "node-a", revision: 2 }, { id: "node-b", revision: 2 }]);
  });

  it("leaves out uploaded files, other pages and notes that are gone", () => {
    expect(citedPageSources([
      { id: "S1", origin: "physics.pdf", locator: "p. 2", text: "text", sourceId: "source-1" },
      { id: "N1", origin: "Other page", locator: "Note", text: "text", pageId: "page-2", objectId: "note" },
      { id: "N2", origin: "Notebook page", locator: "Note", text: "text", pageId: "page-1", objectId: "deleted" },
    ], page)).toEqual([]);
  });
});
