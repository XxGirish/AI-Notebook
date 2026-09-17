import type { UsageReport } from "@ai-notebook/ai-contract";
import { ProviderError, type AiProvider, type ProviderCall, type ProviderResult } from "../types";
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION, PROPOSAL_TOOL_NAME } from "./prompt";
import { buildStrictProposalSchema } from "./providerSchema";
import { readSseData } from "./sse";

export type DeepSeekOutputMode = "strict_tool" | "json_object";

export type DeepSeekProviderOptions = {
  apiKey: string;
  model: string;
  baseUrl: string;
  betaBaseUrl: string;
  outputMode: DeepSeekOutputMode;
  maxOutputTokens: number;
  fetch?: typeof fetch;
};

type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
};

const MAX_OUTPUT_CHARACTERS = 200_000;

/**
 * Calls DeepSeek Chat Completions with thinking disabled and reassembles one
 * complete proposal from the stream. Partial output never leaves this class;
 * reasoning fields are ignored so they cannot reach notebook content or logs.
 */
export class DeepSeekProvider implements AiProvider {
  readonly id = "deepseek";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekProviderOptions) {
    if (!options.apiKey) throw new Error("DeepSeekProvider requires an API key");
    this.fetchImpl = options.fetch ?? fetch;
  }

  get model() {
    return this.options.model;
  }

  get mode() {
    return this.options.outputMode;
  }

  get configurationId() {
    return `deepseek:${this.options.model}:${this.options.outputMode}:thinking-disabled:${PROMPT_VERSION}`;
  }

  buildRequestBody({ request, repair }: Omit<ProviderCall, "signal">): Record<string, unknown> {
    const strict = this.options.outputMode === "strict_tool";
    const schema = buildStrictProposalSchema(new Set(request.permittedOperations));
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: [
        { role: "system", content: buildSystemPrompt(this.options.outputMode, schema) },
        { role: "user", content: buildUserPrompt(request, repair) },
      ],
      thinking: { type: "disabled" },
      max_tokens: this.options.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (strict) {
      body.tools = [{
        type: "function",
        function: {
          name: PROPOSAL_TOOL_NAME,
          description: "Propose semantic study content for the application to validate, lay out, and let the student accept.",
          strict: true,
          parameters: schema,
        },
      }];
      body.tool_choice = { type: "function", function: { name: PROPOSAL_TOOL_NAME } };
    } else {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  async generate(call: ProviderCall): Promise<ProviderResult> {
    const { signal } = call;
    const baseUrl = this.options.outputMode === "strict_tool" ? this.options.betaBaseUrl : this.options.baseUrl;
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(this.buildRequestBody(call)),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw new ProviderError("cancelled", "Generation was cancelled", false);
      throw new ProviderError("provider_unavailable", `DeepSeek could not be reached: ${errorName(error)}`, true);
    }

    if (!response.ok) throw await httpError(response);
    if (!response.body) throw new ProviderError("provider_unavailable", "DeepSeek returned no response stream", true);

    let content = "";
    const toolCalls = new Map<number, { name: string; arguments: string }>();
    let finishReason: string | undefined;
    let usage: UsageReport | undefined;
    let outputCharacters = 0;

    try {
      for await (const data of readSseData(response.body)) {
        if (data === "[DONE]") break;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          throw new ProviderError("provider_unavailable", "DeepSeek sent a malformed stream event", true);
        }
        if (chunk.usage) usage = usageFrom(chunk.usage);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string") {
          content += delta.content;
          outputCharacters += delta.content.length;
        }
        for (const part of delta.tool_calls ?? []) {
          const index = part.index ?? 0;
          const current = toolCalls.get(index) ?? { name: "", arguments: "" };
          if (part.function?.name) current.name += part.function.name;
          if (part.function?.arguments) {
            current.arguments += part.function.arguments;
            outputCharacters += part.function.arguments.length;
          }
          toolCalls.set(index, current);
        }
        if (outputCharacters > MAX_OUTPUT_CHARACTERS) {
          throw new ProviderError("truncated", "The proposal exceeded the gateway's output size limit", false);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    } catch (error) {
      if (signal.aborted) throw new ProviderError("cancelled", "Generation was cancelled", false);
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("provider_unavailable", `DeepSeek stream failed: ${errorName(error)}`, true);
    }

    if (signal.aborted) throw new ProviderError("cancelled", "Generation was cancelled", false);
    switch (finishReason) {
      case "stop":
      case "tool_calls":
        break;
      case "length":
        throw new ProviderError("truncated", "The proposal was cut off by the output token limit", false);
      case "content_filter":
        throw new ProviderError("refused", "DeepSeek declined to produce this content", false);
      case "insufficient_system_resource":
      case "aborted":
        throw new ProviderError("provider_unavailable", `DeepSeek stopped early (${finishReason})`, true);
      case undefined:
        throw new ProviderError("provider_unavailable", "The DeepSeek stream ended before completion", true);
      default:
        throw new ProviderError("provider_unavailable", `Unexpected DeepSeek finish reason: ${finishReason}`, true);
    }

    if (this.options.outputMode === "json_object") {
      return { text: content.trim(), protocolIssues: [], usage };
    }

    const calls = [...toolCalls.values()];
    const protocolIssues: string[] = [];
    if (calls.length !== 1) protocolIssues.push(`Expected exactly one ${PROPOSAL_TOOL_NAME} call, received ${calls.length}`);
    const call0 = calls[0];
    if (call0 && call0.name !== PROPOSAL_TOOL_NAME) protocolIssues.push(`Expected tool ${PROPOSAL_TOOL_NAME}, received ${call0.name.slice(0, 80)}`);
    return { text: (call0?.arguments ?? "").trim(), protocolIssues, usage };
  }
}

function usageFrom(raw: NonNullable<StreamChunk["usage"]>): UsageReport {
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    cachedPromptTokens: raw.prompt_cache_hit_tokens,
    reasoningTokens: raw.completion_tokens_details?.reasoning_tokens,
  };
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown error";
}

async function httpError(response: Response): Promise<ProviderError> {
  // Provider error messages describe the request failure, not notebook content,
  // but they are still capped so an unexpected body cannot flood clients or logs.
  let detail = "";
  try {
    const payload = await response.json() as { error?: { message?: unknown } };
    if (typeof payload.error?.message === "string") detail = `: ${payload.error.message.slice(0, 200)}`;
  } catch {
    // A non-JSON error body adds no reliable detail.
  }
  const status = response.status;
  if (status === 401 || status === 403) return new ProviderError("provider_auth", `DeepSeek rejected the gateway's API key (${status})${detail}`, false);
  if (status === 402) return new ProviderError("provider_balance", `DeepSeek reports insufficient account balance${detail}`, false);
  if (status === 429) return new ProviderError("provider_rate_limited", `DeepSeek rate or concurrency limit reached${detail}`, true);
  if (status === 400 || status === 422) return new ProviderError("provider_bad_request", `DeepSeek rejected the request format (${status})${detail}`, false);
  if (status >= 500) return new ProviderError("provider_unavailable", `DeepSeek service error (${status})`, true);
  return new ProviderError("provider_unavailable", `Unexpected DeepSeek response (${status})${detail}`, false);
}
