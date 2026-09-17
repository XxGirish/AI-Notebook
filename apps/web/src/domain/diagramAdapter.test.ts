import { describe, expect, it } from "vitest";
import type { ConnectorObject, GraphNodeObject, NotebookObject } from "./notebook";
import { collectDiagrams, diagramAdapter, measureDiagramNode, routeConnector } from "./diagramAdapter";

const node = (id: string, label: string, x: number, y: number): GraphNodeObject =>
  ({ id, revision: 1, kind: "graph-node", x, y, width: 100, height: 60, label });
const edge = (id: string, fromId: string, toId: string, label?: string): ConnectorObject =>
  ({ id, revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId, toId, ...(label ? { label } : {}) });

const force = node("force", "Net force", 0, 0);
const mass = node("mass", "Mass", 0, 200);
const acceleration = node("acceleration", "Acceleration", 300, 100);
const page: NotebookObject[] = [
  acceleration,
  edge("e-mass", "mass", "acceleration", "resists"),
  mass,
  force,
  edge("e-force", "force", "acceleration", "increases"),
  node("lonely", "Standalone idea", 0, 500),
  { id: "note", revision: 1, kind: "text-card", x: 600, y: 0, width: 200, height: 100, title: "Note", body: "" },
  edge("e-note", "note", "force", "annotates"),
];

describe("diagram collection adapter", () => {
  it("derives connected diagrams in reading order without absorbing card connections", () => {
    const diagrams = collectDiagrams(page);
    expect(diagrams.map((diagram) => diagram.id)).toEqual(["diagram:acceleration", "diagram:lonely"]);
    expect(diagrams[0].nodes.map((item) => item.id)).toEqual(["force", "acceleration", "mass"]);
    expect(diagrams[0].connectors.map((item) => item.id).sort()).toEqual(["e-force", "e-mass"]);
    expect(diagrams[1].connectors).toEqual([]);
  });

  it("keeps diagram identity stable when nodes move", () => {
    const moved = page.map((object) => object.id === "force" ? { ...object, x: 900, y: 900 } : object);
    expect(collectDiagrams(moved)[0].id).toBe("diagram:acceleration");
  });

  it("validates structure, labels, endpoints, and duplicate IDs", () => {
    const [diagram] = collectDiagrams(page);
    expect(diagramAdapter.validate(diagram)).toEqual([]);
    const broken = {
      ...diagram,
      nodes: [...diagram.nodes, { ...force, label: "" }],
      connectors: [...diagram.connectors, edge("e-self", "mass", "mass"), edge("e-out", "force", "note")],
    };
    const errors = diagramAdapter.validate(broken);
    expect(errors.some((error) => error.includes("duplicate object ID"))).toBe(true);
    expect(errors.some((error) => error.startsWith("node force.label"))).toBe(true);
    expect(errors).toContain("connector e-self: cannot connect a node to itself");
    expect(errors).toContain("connector e-out: target note is not a node in this diagram");
  });

  it("measures node bounds and estimates node size from labels", () => {
    expect(diagramAdapter.measure(collectDiagrams(page)[0])).toEqual({ x: 0, y: 0, width: 400, height: 260 });
    expect(measureDiagramNode("Mass")).toEqual({ width: 140, height: 68 });
    expect(measureDiagramNode("x".repeat(40))).toEqual({ width: 260, height: 84 });
  });

  it("routes connectors between facing sides and reroutes after movement", () => {
    const left = { x: 0, y: 0, width: 100, height: 60 };
    expect(routeConnector(left, { x: 300, y: 0, width: 100, height: 60 })).toEqual({ x1: 100, y1: 30, x2: 300, y2: 30 });
    expect(routeConnector(left, { x: -300, y: 0, width: 100, height: 60 })).toEqual({ x1: 0, y1: 30, x2: -200, y2: 30 });
    expect(routeConnector(left, { x: 0, y: 200, width: 100, height: 60 })).toEqual({ x1: 50, y1: 60, x2: 50, y2: 200 });
    expect(routeConnector(left, { x: 0, y: -200, width: 100, height: 60 })).toEqual({ x1: 50, y1: 0, x2: 50, y2: -140 });
  });

  it("creates render/export models with bound routes and isolated data", () => {
    const [diagram] = collectDiagrams(page);
    const model = diagramAdapter.toExport(diagram);
    expect(model.edges.find((item) => item.id === "e-force")).toEqual({
      id: "e-force", fromId: "force", toId: "acceleration", label: "increases", route: { x1: 100, y1: 30, x2: 300, y2: 130 },
    });
    model.nodes[0].label = "changed";
    expect(force.label).toBe("Net force");
  });

  it("describes nodes and relationships as reading text", () => {
    expect(diagramAdapter.toPlainText(collectDiagrams(page)[0])).toBe(
      "Diagram with 3 nodes: Net force; Acceleration; Mass\nNet force to Acceleration: increases\nMass to Acceleration: resists",
    );
    expect(diagramAdapter.toPlainText(collectDiagrams(page)[1])).toBe("Diagram with 1 node: Standalone idea");
  });

  it("migrates stored diagram objects without truncating legacy content", () => {
    expect(diagramAdapter.migrate({ ...force, revision: 0, label: "x".repeat(5_000) })).toMatchObject({ revision: 1, label: "x".repeat(5_000) });
    expect(diagramAdapter.migrate({ ...edge("e", "a", "b"), label: "" })).not.toHaveProperty("label");
    expect(() => diagramAdapter.migrate({ ...force, script: "alert(1)" })).toThrow("migration failed");
    expect(() => diagramAdapter.migrate({ ...edge("e", "a", "b"), toId: undefined })).toThrow("migration failed");
  });
});
