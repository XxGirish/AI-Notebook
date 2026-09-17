import { z } from "zod";
import type { CanvasProposal, SemanticOperationType } from "./proposalSchema";

// The browser and gateway share this protocol. The browser still owns the
// document: it revalidates every proposal against current page revisions before
// committing, so nothing here grants the gateway or model write access.

export const AI_INTENTS = ["teach_section", "explain_selection", "create_diagram", "create_equation", "create_quiz"] as const;
export type AiIntent = typeof AI_INTENTS[number];

export const SEMANTIC_OPERATION_TYPES = [
  "insert_lesson_section",
  "insert_explanation",
  "insert_diagram",
  "insert_equation",
  "insert_quiz",
  "propose_object_update",
] as const satisfies readonly SemanticOperationType[];

/** Upper bound on a serialized generate request, enforced before parsing. */
export const MAX_GENERATE_REQUEST_BYTES = 64 * 1024;

const idSchema = z.string().min(1).max(200);
const revisionSchema = z.number().int().min(1);

const textContextSchema = z.object({
  kind: z.literal("text"),
  id: idSchema,
  revision: revisionSchema,
  title: z.string().max(160),
  body: z.string().max(8_000),
}).strict();

const equationContextSchema = z.object({
  kind: z.literal("equation"),
  id: idSchema,
  revision: revisionSchema,
  title: z.string().max(160),
  latex: z.string().max(2_000),
}).strict();

// Answer keys are deliberately absent: explaining a question must not require
// sending its stored answer unless a later feature explicitly needs it.
const quizContextSchema = z.object({
  kind: z.literal("quiz"),
  id: idSchema,
  revision: revisionSchema,
  prompt: z.string().max(1_500),
  options: z.array(z.object({ id: idSchema, label: z.string().max(240) }).strict()).max(6),
}).strict();

const diagramContextSchema = z.object({
  kind: z.literal("diagram"),
  id: idSchema,
  nodes: z.array(z.object({ id: idSchema, revision: revisionSchema, label: z.string().max(240) }).strict()).min(1).max(32),
  edges: z.array(z.object({ fromId: idSchema, toId: idSchema, label: z.string().max(160).optional() }).strict()).max(64),
}).strict();

export const ContextItemSchema = z.discriminatedUnion("kind", [
  textContextSchema,
  equationContextSchema,
  quizContextSchema,
  diagramContextSchema,
]);

export const GenerateRequestSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "Use an opaque request identifier"),
  pageId: idSchema,
  intent: z.enum(AI_INTENTS),
  instruction: z.string().trim().max(500).optional(),
  permittedOperations: z.array(z.enum(SEMANTIC_OPERATION_TYPES)).min(1).max(SEMANTIC_OPERATION_TYPES.length),
  maxOperations: z.number().int().min(1).max(12),
  targets: z.array(z.object({
    id: idSchema,
    kind: z.enum(["text-card", "equation-card", "quiz-card"]),
    revision: revisionSchema,
  }).strict()).max(8),
  context: z.array(ContextItemSchema).max(24),
}).strict();

export type ContextItem = z.infer<typeof ContextItemSchema>;
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const GATEWAY_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "request_too_large",
  "busy",
  "rate_limited",
  "budget_exhausted",
  "duplicate_request",
  "provider_auth",
  "provider_balance",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_bad_request",
  "truncated",
  "refused",
  "empty_output",
  "invalid_proposal",
  "timeout",
  "cancelled",
] as const;
export type GatewayErrorCode = typeof GATEWAY_ERROR_CODES[number];

export type UsageReport = {
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
};

export type GatewayEvent =
  | { type: "started"; requestId: string; provider: string; model: string; configurationId: string; mode: string }
  | { type: "progress"; phase: "generating" | "validating" | "repairing" }
  | { type: "proposal"; proposal: CanvasProposal; repairAttempts: number }
  | { type: "usage"; usage: UsageReport; calls: number }
  | { type: "complete" }
  | { type: "error"; code: GatewayErrorCode; message: string; retryable: boolean };

export type GatewayCapabilities = {
  provider: string;
  model: string;
  configurationId: string;
  mode: string;
  intents: AiIntent[];
  imageInput: "unverified" | "verified" | "unsupported";
};
