import { z } from "zod";
import type { ConnectorObject, GraphNodeObject, NotebookObject } from "./notebook";

// A diagram is not a stored object. It is derived from the page: graph nodes
// joined by connectors whose endpoints are both graph nodes. Deriving it keeps
// one authoritative document representation while giving export, reading, and
// validation a single collection-level contract.
export type DiagramCollection = {
  id: string;
  nodes: GraphNodeObject[];
  connectors: ConnectorObject[];
};

export type DiagramRect = { x: number; y: number; width: number; height: number };
export type ConnectorRoute = { x1: number; y1: number; x2: number; y2: number };

export type DiagramRenderModel = {
  kind: "diagram";
  id: string;
  bounds: DiagramRect;
  nodes: Array<{ id: string; label: string } & DiagramRect>;
  edges: Array<{ id: string; fromId: string; toId: string; label?: string; route: ConnectorRoute }>;
};

export type DiagramExportModel = DiagramRenderModel;

export interface DiagramAdapter {
  validate(collection: DiagramCollection): string[];
  measure(collection: DiagramCollection): DiagramRect;
  render(collection: DiagramCollection): DiagramRenderModel;
  toPlainText(collection: DiagramCollection): string;
  toExport(collection: DiagramCollection): DiagramExportModel;
  migrate(value: unknown): GraphNodeObject | ConnectorObject;
}

const MAX_DIAGRAM_NODES = 1_000;
const MAX_DIAGRAM_CONNECTORS = 2_000;

const baseObjectSchema = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  groupId: z.string().min(1).max(200).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).strict();

const graphNodeSchema = baseObjectSchema.extend({
  kind: z.literal("graph-node"),
  label: z.string().min(1).max(240),
}).strict();

const connectorSchema = baseObjectSchema.extend({
  kind: z.literal("connector"),
  fromId: z.string().min(1).max(200),
  toId: z.string().min(1).max(200),
  label: z.string().min(1).max(160).optional(),
}).strict();

// Migration accepts the wider limits of earlier stored-page and archive
// validators so existing diagrams are never truncated by authoring limits.
const legacyGraphNodeSchema = baseObjectSchema.extend({
  kind: z.literal("graph-node"),
  label: z.string().min(1).max(20_000),
}).strict();
const legacyConnectorSchema = baseObjectSchema.extend({
  kind: z.literal("connector"),
  fromId: z.string().min(1).max(200),
  toId: z.string().min(1).max(200),
  label: z.string().max(20_000).optional(),
}).strict();
const legacyDiagramObjectSchema = z.discriminatedUnion("kind", [legacyGraphNodeSchema, legacyConnectorSchema]);

const issuesToMessages = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>, prefix: string) =>
  issues.map((issue) => `${prefix}${issue.path.length ? `.${issue.path.map(String).join(".")}` : ""}: ${issue.message}`);

const readingOrder = (left: DiagramRect & { id: string }, right: DiagramRect & { id: string }) =>
  left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);

/**
 * Routes a connector between the facing sides of two rectangles. The route is
 * recomputed from current geometry, so moving either endpoint reroutes it while
 * the connector keeps referring to the same object IDs.
 */
export function routeConnector(from: DiagramRect, to: DiagramRect): ConnectorRoute {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const rightward = dx >= 0;
    return {
      x1: rightward ? from.x + from.width : from.x,
      y1: from.y + from.height / 2,
      x2: rightward ? to.x : to.x + to.width,
      y2: to.y + to.height / 2,
    };
  }
  const downward = dy >= 0;
  return {
    x1: from.x + from.width / 2,
    y1: downward ? from.y + from.height : from.y,
    x2: to.x + to.width / 2,
    y2: downward ? to.y : to.y + to.height,
  };
}

/** Estimates a node's size from its label before layout; no DOM measurement is needed. */
export function measureDiagramNode(label: string): { width: number; height: number } {
  return {
    width: Math.max(140, Math.min(260, 88 + label.length * 6.4)),
    height: label.length > 28 ? 84 : 68,
  };
}

/** Finds each connected diagram on a page, ordered for reading. */
export function collectDiagrams(objects: readonly NotebookObject[]): DiagramCollection[] {
  const nodes = objects.filter((object): object is GraphNodeObject => object.kind === "graph-node");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connectors = objects.filter((object): object is ConnectorObject =>
    object.kind === "connector" && nodeIds.has(object.fromId) && nodeIds.has(object.toId));

  const parent = new Map(nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const connector of connectors) {
    const fromRoot = find(connector.fromId);
    const toRoot = find(connector.toId);
    if (fromRoot !== toRoot) parent.set(fromRoot, toRoot);
  }

  const components = new Map<string, DiagramCollection>();
  for (const node of nodes) {
    const root = find(node.id);
    const component = components.get(root) ?? { id: "", nodes: [], connectors: [] };
    component.nodes.push(node);
    components.set(root, component);
  }
  for (const connector of connectors) components.get(find(connector.fromId))!.connectors.push(connector);

  return [...components.values()]
    .map((component) => {
      const orderedNodes = [...component.nodes].sort(readingOrder);
      const ids = orderedNodes.map((node) => node.id).sort();
      return { id: `diagram:${ids[0]}`, nodes: orderedNodes, connectors: component.connectors };
    })
    .sort((left, right) => readingOrder(
      { ...diagramAdapter.measure(left), id: left.id },
      { ...diagramAdapter.measure(right), id: right.id },
    ));
}

function renderDiagram(collection: DiagramCollection): DiagramRenderModel {
  const byId = new Map(collection.nodes.map((node) => [node.id, node]));
  return {
    kind: "diagram",
    id: collection.id,
    bounds: diagramAdapter.measure(collection),
    nodes: collection.nodes.map(({ id, label, x, y, width, height }) => ({ id, label, x, y, width, height })),
    edges: collection.connectors.flatMap((connector) => {
      const from = byId.get(connector.fromId);
      const to = byId.get(connector.toId);
      if (!from || !to) return [];
      return [{
        id: connector.id,
        fromId: connector.fromId,
        toId: connector.toId,
        ...(connector.label ? { label: connector.label } : {}),
        route: routeConnector(from, to),
      }];
    }),
  };
}

export const diagramAdapter: DiagramAdapter = {
  validate(collection) {
    const errors: string[] = [];
    if (collection.nodes.length === 0) errors.push("diagram: must contain at least one node");
    if (collection.nodes.length > MAX_DIAGRAM_NODES) errors.push(`diagram: exceeds ${MAX_DIAGRAM_NODES} nodes`);
    if (collection.connectors.length > MAX_DIAGRAM_CONNECTORS) errors.push(`diagram: exceeds ${MAX_DIAGRAM_CONNECTORS} connectors`);

    const ids = new Set<string>();
    const nodeIds = new Set<string>();
    for (const node of collection.nodes) {
      const result = graphNodeSchema.safeParse(node);
      if (!result.success) errors.push(...issuesToMessages(result.error.issues, `node ${node.id}`));
      if (ids.has(node.id)) errors.push(`node ${node.id}: duplicate object ID`);
      ids.add(node.id);
      nodeIds.add(node.id);
    }
    for (const connector of collection.connectors) {
      const result = connectorSchema.safeParse(connector);
      if (!result.success) errors.push(...issuesToMessages(result.error.issues, `connector ${connector.id}`));
      if (ids.has(connector.id)) errors.push(`connector ${connector.id}: duplicate object ID`);
      ids.add(connector.id);
      if (!nodeIds.has(connector.fromId)) errors.push(`connector ${connector.id}: source ${connector.fromId} is not a node in this diagram`);
      if (!nodeIds.has(connector.toId)) errors.push(`connector ${connector.id}: target ${connector.toId} is not a node in this diagram`);
      if (connector.fromId === connector.toId) errors.push(`connector ${connector.id}: cannot connect a node to itself`);
    }
    return errors;
  },

  measure(collection) {
    if (collection.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const left = Math.min(...collection.nodes.map((node) => node.x));
    const top = Math.min(...collection.nodes.map((node) => node.y));
    const right = Math.max(...collection.nodes.map((node) => node.x + node.width));
    const bottom = Math.max(...collection.nodes.map((node) => node.y + node.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  },

  render: renderDiagram,

  toPlainText(collection) {
    const labels = new Map(collection.nodes.map((node) => [node.id, node.label]));
    const order = new Map(collection.nodes.map((node, index) => [node.id, index]));
    const nodeCount = collection.nodes.length;
    const heading = `Diagram with ${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}: ${collection.nodes.map((node) => node.label).join("; ")}`;
    const relations = [...collection.connectors]
      .sort((left, right) =>
        (order.get(left.fromId) ?? 0) - (order.get(right.fromId) ?? 0)
        || (order.get(left.toId) ?? 0) - (order.get(right.toId) ?? 0)
        || left.id.localeCompare(right.id))
      .map((connector) => `${labels.get(connector.fromId) ?? connector.fromId} to ${labels.get(connector.toId) ?? connector.toId}${connector.label ? `: ${connector.label}` : ""}`);
    return [heading, ...relations].join("\n");
  },

  toExport: renderDiagram,

  migrate(value) {
    if (typeof value !== "object" || value === null) throw new Error("Diagram object is not a record");
    const candidate: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if (!Number.isInteger(candidate.revision) || (candidate.revision as number) < 1) candidate.revision = 1;
    // An empty connector label meant "no label"; the current model omits the field.
    if (candidate.kind === "connector" && candidate.label === "") delete candidate.label;
    const result = legacyDiagramObjectSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`Diagram object migration failed at ${issue.path.join(".") || "object"}: ${issue.message}`);
    }
    return result.data;
  },
};
