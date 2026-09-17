import { z } from "zod";

export const CANVAS_PROPOSAL_SCHEMA_VERSION = 1 as const;

const localIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "Use a short local identifier");
const titleSchema = z.string().trim().min(1).max(160);
const bodySchema = z.string().trim().min(1).max(8_000);
const labelSchema = z.string().trim().min(1).max(240);
const anchorSchema = z.object({
  relation: z.enum(["after_selection", "below_selection", "right_of_selection", "viewport_center"]),
}).strict();

export const TextPayloadSchema = z.object({
  kind: z.literal("text"),
  title: titleSchema,
  body: bodySchema,
}).strict();

export const EquationPayloadSchema = z.object({
  kind: z.literal("equation"),
  title: titleSchema,
  latex: z.string().trim().min(1).max(2_000),
  explanation: z.string().trim().min(1).max(4_000).optional(),
}).strict();

const diagramNodeSchema = z.object({
  localId: localIdSchema,
  label: labelSchema,
}).strict();

const diagramEdgeSchema = z.object({
  from: localIdSchema,
  to: localIdSchema,
  label: z.string().trim().min(1).max(160).optional(),
}).strict();

export const DiagramPayloadSchema = z.object({
  kind: z.literal("diagram"),
  title: titleSchema,
  direction: z.enum(["left_to_right", "top_to_bottom"]),
  nodes: z.array(diagramNodeSchema).min(2).max(16),
  edges: z.array(diagramEdgeSchema).min(1).max(32),
}).strict().superRefine((diagram, context) => {
  const nodeIds = new Set<string>();
  for (const [index, node] of diagram.nodes.entries()) {
    if (nodeIds.has(node.localId)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "localId"], message: `Duplicate diagram node: ${node.localId}` });
    }
    nodeIds.add(node.localId);
  }
  for (const [index, edge] of diagram.edges.entries()) {
    if (!nodeIds.has(edge.from)) context.addIssue({ code: "custom", path: ["edges", index, "from"], message: `Unknown diagram node: ${edge.from}` });
    if (!nodeIds.has(edge.to)) context.addIssue({ code: "custom", path: ["edges", index, "to"], message: `Unknown diagram node: ${edge.to}` });
    if (edge.from === edge.to) context.addIssue({ code: "custom", path: ["edges", index], message: "Diagram edges cannot connect a node to itself" });
  }
});

const quizOptionSchema = z.object({
  localId: localIdSchema,
  label: labelSchema,
}).strict();

export const QuizPayloadSchema = z.object({
  kind: z.literal("quiz"),
  prompt: z.string().trim().min(1).max(1_500),
  options: z.array(quizOptionSchema).min(2).max(6),
  correctOptionLocalId: localIdSchema,
  rationale: z.string().trim().min(1).max(3_000),
  conceptTags: z.array(z.string().trim().min(1).max(80)).max(8),
}).strict().superRefine((quiz, context) => {
  const optionIds = new Set<string>();
  for (const [index, option] of quiz.options.entries()) {
    if (optionIds.has(option.localId)) {
      context.addIssue({ code: "custom", path: ["options", index, "localId"], message: `Duplicate quiz option: ${option.localId}` });
    }
    optionIds.add(option.localId);
  }
  if (!optionIds.has(quiz.correctOptionLocalId)) {
    context.addIssue({ code: "custom", path: ["correctOptionLocalId"], message: "The answer key must reference an option" });
  }
});

export const LearningPayloadSchema = z.union([
  TextPayloadSchema,
  EquationPayloadSchema,
  DiagramPayloadSchema,
  QuizPayloadSchema,
]);

const insertLessonSectionSchema = z.object({
  type: z.literal("insert_lesson_section"),
  localId: localIdSchema,
  anchor: anchorSchema,
  title: titleSchema,
  blocks: z.array(LearningPayloadSchema).min(1).max(6),
}).strict();

const insertExplanationSchema = z.object({
  type: z.literal("insert_explanation"),
  localId: localIdSchema,
  anchor: anchorSchema,
  content: TextPayloadSchema,
}).strict();

const insertDiagramSchema = z.object({
  type: z.literal("insert_diagram"),
  localId: localIdSchema,
  anchor: anchorSchema,
  content: DiagramPayloadSchema,
}).strict();

const insertEquationSchema = z.object({
  type: z.literal("insert_equation"),
  localId: localIdSchema,
  anchor: anchorSchema,
  content: EquationPayloadSchema,
}).strict();

const insertQuizSchema = z.object({
  type: z.literal("insert_quiz"),
  localId: localIdSchema,
  anchor: anchorSchema,
  content: QuizPayloadSchema,
}).strict();

const equationUpdatePayloadSchema = z.object({
  kind: z.literal("equation"),
  title: titleSchema,
  latex: z.string().trim().min(1).max(2_000),
}).strict();

const updatePayloadSchema = z.union([TextPayloadSchema, equationUpdatePayloadSchema, QuizPayloadSchema]);

const proposeObjectUpdateSchema = z.object({
  type: z.literal("propose_object_update"),
  targetId: z.string().min(1).max(200),
  expectedRevision: z.number().int().min(1),
  content: updatePayloadSchema,
}).strict();

export const SemanticOperationSchema = z.discriminatedUnion("type", [
  insertLessonSectionSchema,
  insertExplanationSchema,
  insertDiagramSchema,
  insertEquationSchema,
  insertQuizSchema,
  proposeObjectUpdateSchema,
]);

export const CanvasProposalSchema = z.object({
  schemaVersion: z.literal(CANVAS_PROPOSAL_SCHEMA_VERSION),
  operations: z.array(SemanticOperationSchema).min(1).max(12),
}).strict().superRefine((proposal, context) => {
  const localIds = new Set<string>();
  for (const [index, operation] of proposal.operations.entries()) {
    if (!("localId" in operation)) continue;
    if (localIds.has(operation.localId)) {
      context.addIssue({ code: "custom", path: ["operations", index, "localId"], message: `Duplicate operation local id: ${operation.localId}` });
    }
    localIds.add(operation.localId);
  }
});

export type TextPayload = z.infer<typeof TextPayloadSchema>;
export type EquationPayload = z.infer<typeof EquationPayloadSchema>;
export type DiagramPayload = z.infer<typeof DiagramPayloadSchema>;
export type QuizPayload = z.infer<typeof QuizPayloadSchema>;
export type SemanticOperation = z.infer<typeof SemanticOperationSchema>;
export type CanvasProposal = z.infer<typeof CanvasProposalSchema>;
export type SemanticOperationType = SemanticOperation["type"];

export type TrustedProposalContext = {
  requestId: string;
  pageId: string;
  permittedOperations: ReadonlySet<SemanticOperationType>;
  targetObjects: ReadonlyMap<string, { kind: "text-card" | "equation-card" | "quiz-card"; revision: number }>;
  maxOperations: number;
};

const payloadKindForObject = {
  "text-card": "text",
  "equation-card": "equation",
  "quiz-card": "quiz",
} as const;

export class ProposalValidationError extends Error {
  constructor(message: string) {
    super(`Invalid canvas proposal: ${message}`);
    this.name = "ProposalValidationError";
  }
}

export function validateCanvasProposal(input: unknown, trusted: TrustedProposalContext): CanvasProposal {
  const parsed = CanvasProposalSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new ProposalValidationError(`${location}${issue.message}`);
  }
  if (parsed.data.operations.length > trusted.maxOperations) {
    throw new ProposalValidationError(`operation count exceeds this request's limit of ${trusted.maxOperations}`);
  }

  for (const operation of parsed.data.operations) {
    if (!trusted.permittedOperations.has(operation.type)) {
      throw new ProposalValidationError(`operation ${operation.type} was not permitted by request ${trusted.requestId}`);
    }
    if (operation.type !== "propose_object_update") continue;
    const target = trusted.targetObjects.get(operation.targetId);
    if (!target) throw new ProposalValidationError(`update target ${operation.targetId} was not permitted`);
    if (target.revision !== operation.expectedRevision) throw new ProposalValidationError(`update target ${operation.targetId} is stale`);
    if (payloadKindForObject[target.kind] !== operation.content.kind) {
      throw new ProposalValidationError(`update content does not match target ${operation.targetId}`);
    }
  }

  return parsed.data;
}
