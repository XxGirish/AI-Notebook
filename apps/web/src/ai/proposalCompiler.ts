import dagre from "@dagrejs/dagre";
import type { AiTransactionRecord, GeneratedContentProvenance, NotebookObject } from "../domain/notebook";
import type { NotebookPage } from "../domain/pages";
import type { CanvasProposal, DiagramPayload, EquationPayload, LearningPayloadSchema, QuizPayload, SemanticOperation, TextPayload } from "./proposalSchema";
import type { z } from "zod";

type LearningPayload = z.infer<typeof LearningPayloadSchema>;
type Rect = { x: number; y: number; width: number; height: number };

export type PreparedCanvasBatch = {
  transactionId: string;
  pageId: string;
  provenance: GeneratedContentProvenance;
  proposal: CanvasProposal;
  inserts: NotebookObject[];
  updates: Array<{ expectedRevision: number; object: NotebookObject }>;
  generatedObjectIds: string[];
};

export type PrepareCanvasBatchOptions = {
  transactionId: string;
  pageId: string;
  existingObjects: NotebookObject[];
  proposal: CanvasProposal;
  provenance: GeneratedContentProvenance;
  selectionBounds?: Rect;
  viewportCenter: { x: number; y: number };
  idFactory?: () => string;
};

export class CanvasBatchError extends Error {
  constructor(message: string) {
    super(`Canvas batch rejected: ${message}`);
    this.name = "CanvasBatchError";
  }
}

const textHeight = (text: string, width: number, base: number) => {
  const charactersPerLine = Math.max(18, Math.floor((width - 36) / 7.2));
  return base + Math.ceil(text.length / charactersPerLine) * 20;
};

function makeText(payload: TextPayload, id: string, groupId?: string): NotebookObject {
  const width = 320;
  return {
    id,
    revision: 1,
    groupId,
    kind: "text-card",
    x: 0,
    y: 0,
    width,
    height: Math.max(140, Math.min(420, textHeight(payload.body, width, 78))),
    title: payload.title,
    body: payload.body,
  };
}

function makeEquation(payload: EquationPayload, id: string, allocateId: (prefix: string) => string, groupId?: string): NotebookObject[] {
  const equation: NotebookObject = {
    id,
    revision: 1,
    groupId,
    kind: "equation-card",
    x: 0,
    y: 0,
    width: 320,
    height: 140,
    title: payload.title,
    latex: payload.latex,
  };
  if (!payload.explanation) return [equation];
  const explanation = makeText({ kind: "text", title: "Explanation", body: payload.explanation }, allocateId("text"), groupId);
  return [equation, { ...explanation, y: equation.height + 28 }];
}

function makeQuiz(payload: QuizPayload, id: string, allocateId: (prefix: string) => string, groupId?: string): NotebookObject {
  const optionIds = new Map(payload.options.map((option) => [option.localId, allocateId("option")]));
  return {
    id,
    revision: 1,
    groupId,
    kind: "quiz-card",
    x: 0,
    y: 0,
    width: 340,
    height: Math.max(260, 150 + payload.options.length * 46),
    prompt: payload.prompt,
    options: payload.options.map((option) => ({ id: optionIds.get(option.localId)!, label: option.label })),
    correctOptionId: optionIds.get(payload.correctOptionLocalId)!,
    rationale: payload.rationale,
  };
}

function makeDiagram(payload: DiagramPayload, allocateId: (prefix: string) => string, groupId: string): NotebookObject[] {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: payload.direction === "left_to_right" ? "LR" : "TB",
    ranksep: 72,
    nodesep: 42,
    marginx: 12,
    marginy: 12,
  });
  const persistentIds = new Map<string, string>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of payload.nodes) {
    const width = Math.max(140, Math.min(260, 88 + node.label.length * 6.4));
    const height = node.label.length > 28 ? 84 : 68;
    persistentIds.set(node.localId, allocateId("node"));
    sizes.set(node.localId, { width, height });
    graph.setNode(node.localId, { width, height });
  }
  for (const edge of payload.edges) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);

  const nodes: NotebookObject[] = payload.nodes.map((node) => {
    const position = graph.node(node.localId);
    const size = sizes.get(node.localId)!;
    return {
      id: persistentIds.get(node.localId)!,
      revision: 1,
      groupId,
      kind: "graph-node",
      x: position.x - size.width / 2,
      y: position.y - size.height / 2,
      width: size.width,
      height: size.height,
      label: node.label,
    };
  });
  const edges: NotebookObject[] = payload.edges.map((edge) => ({
    id: allocateId("connector"),
    revision: 1,
    groupId,
    kind: "connector",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fromId: persistentIds.get(edge.from)!,
    toId: persistentIds.get(edge.to)!,
    label: edge.label,
  }));
  const bounds = contentBounds(nodes);
  const title: NotebookObject = {
    id: allocateId("text"),
    revision: 1,
    groupId,
    kind: "text-card",
    x: bounds.x,
    y: bounds.y - 108,
    width: Math.max(240, Math.min(420, bounds.width)),
    height: 80,
    title: payload.title,
    body: "",
  };
  return [title, ...nodes, ...edges];
}

function contentBounds(objects: NotebookObject[]): Rect {
  const visible = objects.filter((object) => object.kind !== "connector");
  if (visible.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...visible.map((object) => object.x));
  const top = Math.min(...visible.map((object) => object.y));
  const right = Math.max(...visible.map((object) => object.x + object.width));
  const bottom = Math.max(...visible.map((object) => object.y + object.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function offsetObjects(objects: NotebookObject[], x: number, y: number): NotebookObject[] {
  const bounds = contentBounds(objects);
  const dx = x - bounds.x;
  const dy = y - bounds.y;
  return objects.map((object) => object.kind === "connector" ? object : { ...object, x: object.x + dx, y: object.y + dy });
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x && a.y < b.y + b.height + 24 && a.y + a.height + 24 > b.y;

function findOpenPosition(desired: { x: number; y: number }, size: { width: number; height: number }, occupied: Rect[]): { x: number; y: number } {
  let candidate = { ...desired, width: size.width, height: size.height };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!occupied.some((bounds) => overlaps(candidate, bounds))) return { x: candidate.x, y: candidate.y };
    candidate = { ...candidate, y: candidate.y + 56 };
  }
  throw new CanvasBatchError("no available placement could be found");
}

function desiredPosition(operation: Exclude<SemanticOperation, { type: "propose_object_update" }>, selectionBounds: Rect | undefined, viewportCenter: { x: number; y: number }): { x: number; y: number } {
  const relation = operation.anchor.relation;
  if (!selectionBounds || relation === "viewport_center") return { x: viewportCenter.x - 160, y: viewportCenter.y - 80 };
  if (relation === "right_of_selection") return { x: selectionBounds.x + selectionBounds.width + 48, y: selectionBounds.y };
  return { x: selectionBounds.x, y: selectionBounds.y + selectionBounds.height + 48 };
}

function stackBlocks(blocks: NotebookObject[][]): NotebookObject[] {
  let y = 0;
  const result: NotebookObject[] = [];
  for (const block of blocks) {
    const shifted = offsetObjects(block, 0, y);
    result.push(...shifted);
    y += contentBounds(shifted).height + 28;
  }
  return result;
}

function replacementFor(operation: Extract<SemanticOperation, { type: "propose_object_update" }>, existing: NotebookObject, allocateId: (prefix: string) => string): NotebookObject {
  if (operation.content.kind === "text" && existing.kind === "text-card") {
    return { ...existing, revision: existing.revision + 1, title: operation.content.title, body: operation.content.body };
  }
  if (operation.content.kind === "equation" && existing.kind === "equation-card") {
    return { ...existing, revision: existing.revision + 1, title: operation.content.title, latex: operation.content.latex };
  }
  if (operation.content.kind === "quiz" && existing.kind === "quiz-card") {
    const optionIds = new Map(operation.content.options.map((option) => [option.localId, allocateId("option")]));
    return {
      ...existing,
      revision: existing.revision + 1,
      prompt: operation.content.prompt,
      options: operation.content.options.map((option) => ({ id: optionIds.get(option.localId)!, label: option.label })),
      correctOptionId: optionIds.get(operation.content.correctOptionLocalId)!,
      rationale: operation.content.rationale,
    };
  }
  throw new CanvasBatchError(`update content does not match ${existing.id}`);
}

export function prepareCanvasBatch(options: PrepareCanvasBatchOptions): PreparedCanvasBatch {
  if (!options.transactionId || !options.pageId) throw new CanvasBatchError("transaction and page IDs are required");
  if (options.provenance.proposalSchemaVersion !== options.proposal.schemaVersion) throw new CanvasBatchError("proposal provenance uses a different schema version");
  const usedIds = new Set(options.existingObjects.flatMap((object) => [
    object.id,
    ...(object.groupId ? [object.groupId] : []),
    ...(object.kind === "quiz-card" ? object.options.map((option) => option.id) : []),
  ]));
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const allocateId = (prefix: string) => {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const candidate = `${prefix}-${idFactory()}`;
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
    throw new CanvasBatchError("unique object IDs could not be allocated");
  };
  const existingById = new Map(options.existingObjects.map((object) => [object.id, object]));
  const occupied = options.existingObjects.filter((object) => object.kind !== "connector").map((object) => ({ x: object.x, y: object.y, width: object.width, height: object.height }));
  const inserts: NotebookObject[] = [];
  const updates: PreparedCanvasBatch["updates"] = [];

  const objectsForPayload = (payload: LearningPayload, groupId?: string): NotebookObject[] => {
    if (payload.kind === "text") return [makeText(payload, allocateId("text"), groupId)];
    if (payload.kind === "equation") return makeEquation(payload, allocateId("equation"), allocateId, groupId);
    if (payload.kind === "quiz") return [makeQuiz(payload, allocateId("quiz"), allocateId, groupId)];
    return makeDiagram(payload, allocateId, groupId ?? allocateId("group"));
  };

  for (const operation of options.proposal.operations) {
    if (operation.type === "propose_object_update") {
      const existing = existingById.get(operation.targetId);
      if (!existing || existing.revision !== operation.expectedRevision) throw new CanvasBatchError(`update target ${operation.targetId} is missing or stale`);
      updates.push({ expectedRevision: operation.expectedRevision, object: replacementFor(operation, existing, allocateId) });
      continue;
    }

    let generated: NotebookObject[];
    if (operation.type === "insert_lesson_section") {
      const groupId = allocateId("group");
      const heading: NotebookObject[] = [{
        id: allocateId("text"), revision: 1, groupId, kind: "text-card", x: 0, y: 0,
        width: 360, height: 80, title: operation.title, body: "",
      }];
      generated = stackBlocks([heading, ...operation.blocks.map((block) => objectsForPayload(block, groupId))]);
    } else {
      const payload = operation.content;
      const needsGroup = payload.kind === "diagram" || (payload.kind === "equation" && Boolean(payload.explanation));
      generated = objectsForPayload(payload, needsGroup ? allocateId("group") : undefined);
    }
    const bounds = contentBounds(generated);
    const position = findOpenPosition(desiredPosition(operation, options.selectionBounds, options.viewportCenter), bounds, occupied);
    generated = offsetObjects(generated, position.x, position.y);
    inserts.push(...generated);
    occupied.push({ ...position, width: bounds.width, height: bounds.height });
  }

  return {
    transactionId: options.transactionId,
    pageId: options.pageId,
    provenance: structuredClone(options.provenance),
    proposal: structuredClone(options.proposal),
    inserts,
    updates,
    generatedObjectIds: inserts.map((object) => object.id),
  };
}

export function applyCanvasBatch(currentPageId: string, currentObjects: NotebookObject[], batch: PreparedCanvasBatch, committedTransactionIds: ReadonlySet<string>): { objects: NotebookObject[]; applied: boolean } {
  if (currentPageId !== batch.pageId) throw new CanvasBatchError(`transaction belongs to page ${batch.pageId}`);
  if (committedTransactionIds.has(batch.transactionId)) return { objects: currentObjects, applied: false };
  const currentById = new Map(currentObjects.map((object) => [object.id, object]));
  for (const source of batch.provenance.sources) {
    const current = currentById.get(source.id);
    if (!current || current.revision !== source.revision) throw new CanvasBatchError(`source ${source.id} changed before commit`);
  }
  for (const insert of batch.inserts) if (currentById.has(insert.id)) throw new CanvasBatchError(`insert ID ${insert.id} already exists`);
  for (const update of batch.updates) {
    const current = currentById.get(update.object.id);
    if (!current || current.revision !== update.expectedRevision) throw new CanvasBatchError(`update target ${update.object.id} changed before commit`);
  }

  const replacements = new Map(batch.updates.map((update) => [update.object.id, update.object]));
  return {
    objects: [...currentObjects.map((object) => replacements.get(object.id) ?? object), ...batch.inserts],
    applied: true,
  };
}

export function commitCanvasBatchToPage(page: NotebookPage, batch: PreparedCanvasBatch, committedAt = Date.now()): NotebookPage {
  const committedIds = new Set(page.aiTransactions.map((transaction) => transaction.transactionId));
  const applied = applyCanvasBatch(page.id, page.objects, batch, committedIds);
  if (!applied.applied) return page;
  const transaction = transactionRecordFromBatch(batch, committedAt);
  return {
    ...page,
    objects: applied.objects,
    aiTransactions: [...page.aiTransactions, transaction],
    updatedAt: Math.max(committedAt, page.updatedAt + 1),
  };
}

export function transactionRecordFromBatch(batch: PreparedCanvasBatch, committedAt = Date.now()): AiTransactionRecord {
  return {
    ...structuredClone(batch.provenance),
    transactionId: batch.transactionId,
    committedAt,
    generatedObjectIds: batch.inserts.map((object) => object.id),
    updatedObjectIds: batch.updates.map((update) => update.object.id),
  };
}
