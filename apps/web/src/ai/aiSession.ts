import {
  ProposalValidationError,
  validateCanvasProposal,
  type AiIntent,
  type GatewayErrorCode,
  type UsageReport,
} from "@ai-notebook/ai-contract";
import type { NotebookObject } from "../domain/notebook";
import { cancelGeneration, describeGatewayError, GatewayError, streamGeneration, type GatewayClientOptions } from "./gatewayClient";
import { prepareCanvasBatch, type PreparedCanvasBatch } from "./proposalCompiler";
import { AI_REQUEST_PLANS, AiRequestError, buildGenerateRequest } from "./requestContext";

/**
 * One AI action, end to end: build a bounded request from the page, stream the
 * gateway's answer, revalidate the proposal against this request's permissions
 * and the page's current revisions, and lay the result out locally as a draft.
 *
 * Nothing here touches the document. The draft is applied only when the writer
 * accepts it, which rechecks revisions again.
 */

export type AiDraftPhase = "sending" | "generating" | "validating" | "repairing" | "preparing";

export type AiDraftOutcome =
  | { status: "draft"; batch: PreparedCanvasBatch; usage?: UsageReport }
  | { status: "cancelled" }
  | { status: "error"; code: GatewayErrorCode | "local"; message: string; retryable: boolean };

type Rect = { x: number; y: number; width: number; height: number };

export type RequestAiDraftOptions = GatewayClientOptions & {
  pageId: string;
  intent: AiIntent;
  instruction?: string;
  objects: NotebookObject[];
  selectedIds: ReadonlySet<string>;
  selectionBounds?: Rect;
  viewportCenter: { x: number; y: number };
  signal?: AbortSignal;
  onPhase?: (phase: AiDraftPhase) => void;
  requestId?: string;
  transactionId?: string;
  idFactory?: () => string;
};

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export async function requestAiDraft(options: RequestAiDraftOptions): Promise<AiDraftOutcome> {
  const requestId = options.requestId ?? newId("request");
  const plan = AI_REQUEST_PLANS[options.intent];
  const anchor = options.selectionBounds
    ? { x: options.selectionBounds.x + options.selectionBounds.width / 2, y: options.selectionBounds.y + options.selectionBounds.height / 2 }
    : options.viewportCenter;

  let built;
  try {
    built = buildGenerateRequest({
      requestId,
      pageId: options.pageId,
      intent: options.intent,
      instruction: options.instruction,
      objects: options.objects,
      selectedIds: options.selectedIds,
      anchor,
    });
  } catch (error) {
    if (error instanceof AiRequestError) return { status: "error", code: "local", message: error.message, retryable: false };
    throw error;
  }

  const client: GatewayClientOptions = { baseUrl: options.baseUrl, accessToken: options.accessToken, fetchImpl: options.fetchImpl };
  let proposalPayload: unknown;
  let started: { provider: string; model: string; configurationId: string } | undefined;
  let usage: UsageReport | undefined;
  let streamError: { code: GatewayErrorCode; message: string; retryable: boolean } | undefined;

  options.onPhase?.("sending");
  try {
    await streamGeneration(built.request, {
      ...client,
      signal: options.signal,
      onEvent: (event) => {
        switch (event.type) {
          case "started":
            started = { provider: event.provider, model: event.model, configurationId: event.configurationId };
            options.onPhase?.("generating");
            break;
          case "progress":
            options.onPhase?.(event.phase === "repairing" ? "repairing" : event.phase === "validating" ? "validating" : "generating");
            break;
          case "proposal":
            proposalPayload = event.proposal;
            break;
          case "usage":
            usage = event.usage;
            break;
          case "error":
            streamError = { code: event.code, message: describeGatewayError(event.code, event.message), retryable: event.retryable };
            break;
          default:
            break;
        }
      },
    });
  } catch (error) {
    if (options.signal?.aborted) {
      void cancelGeneration(requestId, client);
      return { status: "cancelled" };
    }
    if (error instanceof GatewayError) return { status: "error", code: error.code, message: error.message, retryable: error.retryable };
    return { status: "error", code: "provider_unavailable", message: "The gateway could not be reached.", retryable: true };
  }

  if (options.signal?.aborted) return { status: "cancelled" };
  if (streamError) return { status: "error", ...streamError };
  if (proposalPayload === undefined) {
    return { status: "error", code: "empty_output", message: describeGatewayError("empty_output", "No proposal arrived."), retryable: true };
  }

  options.onPhase?.("preparing");
  try {
    // Validated a second time on this device: the gateway's own check is not
    // trusted, and the page may have changed while the request was in flight.
    const proposal = validateCanvasProposal(proposalPayload, {
      requestId,
      pageId: options.pageId,
      permittedOperations: new Set(plan.permittedOperations),
      targetObjects: new Map(),
      maxOperations: plan.maxOperations,
    });
    const batch = prepareCanvasBatch({
      transactionId: options.transactionId ?? newId("transaction"),
      pageId: options.pageId,
      existingObjects: options.objects,
      proposal,
      provenance: {
        requestId,
        intent: options.intent,
        provider: started?.provider ?? "unknown",
        model: started?.model ?? "unknown",
        configurationId: started?.configurationId ?? "unknown",
        proposalSchemaVersion: proposal.schemaVersion,
        sources: built.sources,
      },
      selectionBounds: options.selectionBounds,
      viewportCenter: options.viewportCenter,
      ...(options.idFactory ? { idFactory: options.idFactory } : {}),
    });
    return { status: "draft", batch, ...(usage ? { usage } : {}) };
  } catch (error) {
    if (error instanceof ProposalValidationError) {
      return { status: "error", code: "invalid_proposal", message: error.message, retryable: true };
    }
    return {
      status: "error",
      code: "local",
      message: error instanceof Error ? error.message : "The answer could not be laid out on this page.",
      retryable: false,
    };
  }
}
