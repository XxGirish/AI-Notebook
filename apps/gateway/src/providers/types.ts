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
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
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
