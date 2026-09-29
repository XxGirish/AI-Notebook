import {
  CanvasProposalSchema,
  ProposalValidationError,
  validateCanvasProposal,
  type CanvasProposal,
  type GatewayErrorCode,
  type GatewayEvent,
  type GenerateRequest,
  type UsageReport,
} from "@ai-notebook/ai-contract";
import { stripNullMembers } from "./providers/deepseek/providerSchema";
import { addUsage, ProviderError, type AiProvider, type RepairContext } from "./providers/types";

export type GenerationOutcome = {
  outcome: "proposal" | "error";
  errorCode?: GatewayErrorCode;
  calls: number;
  repairAttempts: number;
  usage: UsageReport;
};

type RunGenerationOptions = {
  request: GenerateRequest;
  provider: AiProvider;
  signal: AbortSignal;
  /** Distinguishes a server timeout from a client cancellation when the signal aborts. */
  timedOut: () => boolean;
  emit: (event: GatewayEvent) => Promise<void> | void;
  maxRepairAttempts?: number;
  /**
   * Why an attempt was rejected. The HTTP gateway never passes this, so nothing
   * it carries can reach a client: the browser still receives only the generic
   * `invalid_proposal` message. The prompt evaluation passes it, because a
   * failure rate is not actionable without the validator's reasons.
   */
  onAttempt?: (attempt: { index: number; accepted: boolean; errors: string[]; outputCharacters: number; output: string }) => void;
};

const MAX_REPORTED_ISSUES = 10;

type Checked = { proposal: CanvasProposal } | { errors: string[] };

export function checkProposalText(text: string, protocolIssues: string[], request: GenerateRequest): Checked {
  if (protocolIssues.length > 0) return { errors: protocolIssues };
  if (!text) return { errors: ["The response was empty"] };

  let parsed: unknown;
  try {
    parsed = stripNullMembers(JSON.parse(text));
  } catch {
    return { errors: ["The response was not valid JSON"] };
  }

  const structural = CanvasProposalSchema.safeParse(parsed);
  if (!structural.success) {
    return {
      errors: structural.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) =>
        `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`),
    };
  }

  try {
    return {
      proposal: validateCanvasProposal(structural.data, {
        requestId: request.requestId,
        pageId: request.pageId,
        permittedOperations: new Set(request.permittedOperations),
        targetObjects: new Map(request.targets.map((target) => [target.id, { kind: target.kind, revision: target.revision }])),
        maxOperations: request.maxOperations,
      }),
    };
  } catch (error) {
    if (error instanceof ProposalValidationError) return { errors: [error.message] };
    throw error;
  }
}

/**
 * Runs one explicit generation: provider call, full application validation,
 * and at most one repair. Only a complete validated proposal is emitted; the
 * browser still rechecks it against current page revisions before committing.
 */
export async function runGeneration({ request, provider, signal, timedOut, emit, maxRepairAttempts = 1, onAttempt }: RunGenerationOptions): Promise<GenerationOutcome> {
  let usage: UsageReport = {};
  let calls = 0;
  let repair: RepairContext | undefined;
  let lastWasEmpty = false;

  await emit({ type: "started", requestId: request.requestId, provider: provider.id, model: provider.model, configurationId: provider.configurationId, mode: provider.mode });

  const fail = async (code: GatewayErrorCode, message: string, retryable: boolean): Promise<GenerationOutcome> => {
    if (calls > 0) await emit({ type: "usage", usage, calls });
    await emit({ type: "error", code, message, retryable });
    return { outcome: "error", errorCode: code, calls, repairAttempts: Math.max(0, calls - 1), usage };
  };

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    await emit({ type: "progress", phase: attempt === 0 ? "generating" : "repairing" });
    let result;
    try {
      calls += 1;
      result = await provider.generate({ request, repair, signal });
    } catch (error) {
      if (signal.aborted) {
        return timedOut()
          ? fail("timeout", "Generation took too long and was stopped", true)
          : fail("cancelled", "Generation was cancelled", false);
      }
      if (error instanceof ProviderError) return fail(error.code, error.message, error.retryable);
      return fail("provider_unavailable", "The AI provider failed unexpectedly", true);
    }
    usage = addUsage(usage, result.usage);

    await emit({ type: "progress", phase: "validating" });
    const checked = checkProposalText(result.text, result.protocolIssues, request);
    onAttempt?.({
      index: attempt,
      accepted: "proposal" in checked,
      errors: "errors" in checked ? checked.errors : [],
      outputCharacters: result.text.length,
      output: result.text,
    });
    if ("proposal" in checked) {
      await emit({ type: "usage", usage, calls });
      await emit({ type: "proposal", proposal: checked.proposal, repairAttempts: attempt });
      await emit({ type: "complete" });
      return { outcome: "proposal", calls, repairAttempts: attempt, usage };
    }
    lastWasEmpty = result.text === "" && result.protocolIssues.length === 0;
    repair = { previousOutput: result.text, errors: checked.errors };
  }

  return lastWasEmpty
    ? fail("empty_output", "The AI provider returned an empty response", true)
    : fail("invalid_proposal", "The AI response could not be turned into valid notebook content", true);
}
