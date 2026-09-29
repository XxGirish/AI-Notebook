import type { ChatRequest, GatewayErrorCode, GenerateRequest, UsageReport } from "@ai-notebook/ai-contract";

export type RepairContext = {
  previousOutput: string;
  errors: string[];
};

export type ProviderCall = {
  request: GenerateRequest;
  repair?: RepairContext;
  signal: AbortSignal;
};

export type ProviderResult = {
  /** The complete proposal text: tool arguments or JSON message content. */
  text: string;
  /** Protocol problems (for example the wrong tool) that make the output repairable but invalid. */
  protocolIssues: string[];
  usage?: UsageReport;
};

export type ChatCall = {
  request: ChatRequest;
  signal: AbortSignal;
  /** Receives answer text as it streams. Reasoning fields never reach it. */
  onDelta: (text: string) => void | Promise<void>;
};

export type ChatResult = { usage?: UsageReport };

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  readonly mode: string;
  readonly configurationId: string;
  /** Identifies the chat prompt and settings, which differ from canvas generation. */
  readonly chatConfigurationId: string;
  generate(call: ProviderCall): Promise<ProviderResult>;
  chat(call: ChatCall): Promise<ChatResult>;
}

export class ProviderError extends Error {
  /** Usage the provider reported before the call failed, such as for an answer cut off at the token limit. */
  usage?: UsageReport;
  /**
   * Tokens the call may have been billed for when it reached the provider but
   * failed before usage was reported (a cancel, timeout or broken stream).
   * DeepSeek reports usage only in the final stream chunk.
   */
  estimatedTokens = 0;

  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function reportedTokens(usage: UsageReport | undefined): number {
  return (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
}

/**
 * A deliberately high token estimate for text whose usage was never reported.
 * About three characters per token overcounts English prose and JSON, which is
 * the safe direction for a spend limit.
 */
export function estimateTokens(characters: number): number {
  return Math.ceil(Math.max(0, characters) / 3);
}

/**
 * Attaches what a failed call cost, or may have cost, to its error so the
 * gateway can charge it against the daily budget. Reported usage wins; an
 * estimate is used only when the request reached the provider and nothing was
 * reported. Anything that is not a ProviderError passes through unchanged.
 */
export function chargeFailedCall(error: unknown, cost: { usage?: UsageReport; reached: boolean; sentCharacters: number; outputCharacters: number }): unknown {
  if (!(error instanceof ProviderError)) return error;
  if (cost.usage) error.usage = cost.usage;
  else if (cost.reached) error.estimatedTokens = estimateTokens(cost.sentCharacters) + estimateTokens(cost.outputCharacters);
  return error;
}

export function addUsage(total: UsageReport, next: UsageReport | undefined): UsageReport {
  if (!next) return total;
  const sum = (left?: number, right?: number) => left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  return {
    promptTokens: sum(total.promptTokens, next.promptTokens),
    completionTokens: sum(total.completionTokens, next.completionTokens),
    cachedPromptTokens: sum(total.cachedPromptTokens, next.cachedPromptTokens),
    reasoningTokens: sum(total.reasoningTokens, next.reasoningTokens),
  };
}
