import {
  AI_INTENTS,
  MAX_GENERATE_REQUEST_BYTES,
  type AiIntent,
  type ContextItem,
  type GenerateRequest,
  type SemanticOperationType,
} from "@ai-notebook/ai-contract";
import { collectDiagrams } from "../domain/diagramAdapter";
import type { NotebookObject } from "../domain/notebook";

/**
 * What one AI action is allowed to ask for. The browser decides this, not the
 * model and not the gateway: the same plan is sent with the request and used
 * again locally when the returned proposal is validated, so a proposal that
 * exceeds the action can never reach the page.
 */
export type AiRequestPlan = {
  label: string;
  permittedOperations: SemanticOperationType[];
  maxOperations: number;
  /** Actions that read the writer's work refuse to run with nothing selected. */
  requiresContext: boolean;
};

// `propose_object_update` is deliberately absent from every plan: no action
// exposed on the canvas yet rewrites existing objects, so no request permits it
// and `targets` stays empty.
export const AI_REQUEST_PLANS: Record<AiIntent, AiRequestPlan> = {
  teach_section: { label: "Teach a section", permittedOperations: ["insert_lesson_section"], maxOperations: 2, requiresContext: false },
  explain_selection: { label: "Explain selection", permittedOperations: ["insert_explanation"], maxOperations: 2, requiresContext: true },
  create_diagram: { label: "Create diagram", permittedOperations: ["insert_diagram"], maxOperations: 1, requiresContext: true },
  create_equation: { label: "Create equation", permittedOperations: ["insert_equation"], maxOperations: 2, requiresContext: true },
  create_quiz: { label: "Create quiz", permittedOperations: ["insert_quiz"], maxOperations: 3, requiresContext: true },
};

/** The actions Phase 3 puts on the canvas toolbar, in toolbar order. */
export const AI_CANVAS_ACTIONS: AiIntent[] = ["teach_section", "explain_selection", "create_diagram", "create_quiz"];

/** Contract ceilings, applied here so an over-long note is trimmed rather than refused. */
const LIMITS = {
  title: 160,
  body: 8_000,
  latex: 2_000,
  quizPrompt: 1_500,
  optionLabel: 240,
  quizOptions: 6,
  diagramNodes: 32,
  diagramEdges: 64,
  items: 24,
  instruction: 500,
};

/** Leaves room for the request fields that are not context. */
const CONTEXT_BYTE_BUDGET = MAX_GENERATE_REQUEST_BYTES - 4 * 1024;

const clamp = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1)}…`);

type Rect = { x: number; y: number; width: number; height: number };

export type ContextCandidate = { item: ContextItem; selected: boolean; distance: number };

const centerOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

function distanceBetween(rect: Rect, point: { x: number; y: number }) {
  const center = centerOf(rect);
  return Math.hypot(center.x - point.x, center.y - point.y);
}

/** Writing, cards and derived diagrams become context; ink and pictures have no text to send. */
function contextItemForObject(object: NotebookObject): ContextItem | undefined {
  switch (object.kind) {
    case "text-card":
      return {
        kind: "text",
        id: object.id,
        revision: object.revision,
        title: clamp(object.title, LIMITS.title),
        body: clamp(object.body, LIMITS.body),
      };
    case "text":
    case "ink-text":
      return { kind: "text", id: object.id, revision: object.revision, title: "", body: clamp(object.text, LIMITS.body) };
    case "equation-card":
      return {
        kind: "equation",
        id: object.id,
        revision: object.revision,
        title: clamp(object.title, LIMITS.title),
        latex: clamp(object.latex, LIMITS.latex),
      };
    case "quiz-card":
      // The answer key stays on the device: no action needs it to produce new work.
      return {
        kind: "quiz",
        id: object.id,
        revision: object.revision,
        prompt: clamp(object.prompt, LIMITS.quizPrompt),
        options: object.options
          .slice(0, LIMITS.quizOptions)
          .map((option) => ({ id: option.id, label: clamp(option.label, LIMITS.optionLabel) })),
      };
    default:
      return undefined;
  }
}

export function buildContextCandidates(
  objects: NotebookObject[],
  selectedIds: ReadonlySet<string>,
  anchor: { x: number; y: number },
): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  const diagramMemberIds = new Set<string>();

  for (const diagram of collectDiagrams(objects)) {
    for (const node of diagram.nodes) diagramMemberIds.add(node.id);
    for (const connector of diagram.connectors) diagramMemberIds.add(connector.id);
    const nodes = diagram.nodes.slice(0, LIMITS.diagramNodes);
    if (nodes.length === 0) continue;
    const keptNodeIds = new Set(nodes.map((node) => node.id));
    const edges = diagram.connectors
      .filter((connector) => keptNodeIds.has(connector.fromId) && keptNodeIds.has(connector.toId))
      .slice(0, LIMITS.diagramEdges)
      .map((connector) =>
        connector.label
          ? { fromId: connector.fromId, toId: connector.toId, label: clamp(connector.label, LIMITS.title) }
          : { fromId: connector.fromId, toId: connector.toId },
      );
    const members = [...diagram.nodes, ...diagram.connectors];
    candidates.push({
      item: {
        kind: "diagram",
        id: diagram.id,
        nodes: nodes.map((node) => ({ id: node.id, revision: node.revision, label: clamp(node.label, LIMITS.optionLabel) })),
        edges,
      },
      selected: members.some((member) => selectedIds.has(member.id)),
      distance: Math.min(...nodes.map((node) => distanceBetween(node, anchor))),
    });
  }

  for (const object of objects) {
    if (diagramMemberIds.has(object.id)) continue;
    const item = contextItemForObject(object);
    if (!item) continue;
    candidates.push({ item, selected: selectedIds.has(object.id), distance: distanceBetween(object, anchor) });
  }

  // Selected work first, then whatever the writer is looking at, nearest outward.
  return candidates.sort((a, b) => (a.selected === b.selected ? a.distance - b.distance : a.selected ? -1 : 1));
}

export class AiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRequestError";
  }
}

export type BuildGenerateRequestOptions = {
  requestId: string;
  pageId: string;
  intent: AiIntent;
  instruction?: string;
  objects: NotebookObject[];
  selectedIds: ReadonlySet<string>;
  /** Selection centre when something is selected, otherwise the middle of the view. */
  anchor: { x: number; y: number };
};

export type BuiltGenerateRequest = {
  request: GenerateRequest;
  /** Revisions of everything sent, recorded as the provenance of whatever is committed. */
  sources: Array<{ id: string; revision: number }>;
};

/**
 * Turns the page and the current selection into one bounded request. Everything
 * that leaves the device passes through here.
 */
export function buildGenerateRequest(options: BuildGenerateRequestOptions): BuiltGenerateRequest {
  if (!AI_INTENTS.includes(options.intent)) throw new AiRequestError(`Unknown action: ${options.intent}`);
  const plan = AI_REQUEST_PLANS[options.intent];
  const candidates = buildContextCandidates(options.objects, options.selectedIds, options.anchor);

  if (plan.requiresContext && !candidates.some((candidate) => candidate.selected)) {
    throw new AiRequestError(`${plan.label} needs something to work from. Select a note, card or diagram first.`);
  }

  const ranked = candidates.slice(0, LIMITS.items);
  const instruction = options.instruction?.trim() ? clamp(options.instruction.trim(), LIMITS.instruction) : undefined;

  const withContext = (context: ContextItem[]): GenerateRequest => ({
    requestId: options.requestId,
    pageId: options.pageId,
    intent: options.intent,
    ...(instruction ? { instruction } : {}),
    permittedOperations: [...plan.permittedOperations],
    maxOperations: plan.maxOperations,
    targets: [],
    context,
  });

  // Drop the least relevant context until the request fits the gateway's limit.
  let context = ranked.map((candidate) => candidate.item);
  const encoder = new TextEncoder();
  while (context.length > 0 && encoder.encode(JSON.stringify(withContext(context))).length > CONTEXT_BYTE_BUDGET) {
    context = context.slice(0, -1);
  }
  if (context.length === 0 && ranked.length > 0) {
    throw new AiRequestError("The selected note is too large to send. Select less of the page and try again.");
  }

  const revisionsById = new Map<string, number>();
  for (const item of context) {
    if (item.kind === "diagram") {
      for (const node of item.nodes) revisionsById.set(node.id, node.revision);
    } else {
      revisionsById.set(item.id, item.revision);
    }
  }

  return {
    request: withContext(context),
    sources: [...revisionsById].map(([id, revision]) => ({ id, revision })),
  };
}
