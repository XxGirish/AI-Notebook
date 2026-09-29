import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import {
  AI_INTENTS,
  ChatRequestSchema,
  GenerateRequestSchema,
  MAX_CHAT_REQUEST_BYTES,
  MAX_GENERATE_REQUEST_BYTES,
  type ChatEvent,
  type GatewayCapabilities,
  type GatewayErrorCode,
  type GatewayEvent,
  type UsageReport,
} from "@ai-notebook/ai-contract";
import { runGeneration } from "./generation";
import type { GenerationLimiter } from "./limits";
import { ProviderError, reportedTokens, type AiProvider } from "./providers/types";

export type GenerationLogRecord = {
  event: "generation";
  requestId: string;
  intent: string;
  provider: string;
  model: string;
  configurationId: string;
  outcome: "proposal" | "answer" | "error";
  errorCode?: GatewayErrorCode;
  calls: number;
  repairAttempts: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  /** Charged to the daily budget for failed calls that never reported usage. */
  estimatedTokens?: number;
};

export type GatewayAppOptions = {
  provider: AiProvider;
  limiter: GenerationLimiter;
  accessToken?: string;
  generationTimeoutMs: number;
  keepAliveMs?: number;
  /** Receives redacted metadata only: never context, prompts, outputs, or keys. */
  log?: (record: GenerationLogRecord) => void;
  now?: () => number;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

function jsonError(c: Context, status: 400 | 401 | 404 | 409 | 413 | 429, code: GatewayErrorCode, message: string, retryable = false) {
  return c.json({ type: "error", code, message, retryable }, status);
}

export function createGatewayApp(options: GatewayAppOptions) {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const active = new Map<string, AbortController>();
  const expectedToken = options.accessToken ? digest(options.accessToken) : undefined;

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.use("/api/ai/*", async (c, next) => {
    if (expectedToken) {
      const header = c.req.header("Authorization") ?? "";
      const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
      // Comparing fixed-length digests avoids leaking token length or prefix timing.
      if (!supplied || !timingSafeEqual(digest(supplied), expectedToken)) {
        return jsonError(c, 401, "unauthorized", "Gateway access token is missing or incorrect");
      }
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/api/ai/capabilities", (c) => {
    const capabilities: GatewayCapabilities = {
      provider: options.provider.id,
      model: options.provider.model,
      configurationId: options.provider.configurationId,
      mode: options.provider.mode,
      intents: [...AI_INTENTS],
      // Image input is not sent by this gateway yet and has not been probed on a real account.
      imageInput: "unverified",
    };
    return c.json(capabilities);
  });

  app.post(
    "/api/ai/generate",
    bodyLimit({
      maxSize: MAX_GENERATE_REQUEST_BYTES,
      onError: (c) => jsonError(c, 413, "request_too_large", "The selected context is too large to send"),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return jsonError(c, 400, "invalid_request", "The request body must be JSON");
      }
      const parsed = GenerateRequestSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return jsonError(c, 400, "invalid_request", `${issue.path.join(".") || "request"}: ${issue.message}`);
      }
      const request = parsed.data;

      const admission = options.limiter.admit(request.requestId);
      if (!admission.ok) return jsonError(c, admission.status, admission.code, admission.message, admission.code !== "duplicate_request");

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.generationTimeoutMs);
      active.set(request.requestId, controller);
      const startedAt = now();

      return streamSSE(c, async (stream) => {
        stream.onAbort(() => controller.abort());
        const keepAlive = setInterval(() => {
          void stream.write(": keep-alive\n\n");
        }, options.keepAliveMs ?? 15_000);
        let billedTokens = 0;
        try {
          const emit = async (event: GatewayEvent) => {
            if (event.type === "usage") billedTokens = (event.usage.promptTokens ?? 0) + (event.usage.completionTokens ?? 0);
            if (stream.aborted) return;
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          };
          const outcome = await runGeneration({
            request,
            provider: options.provider,
            signal: controller.signal,
            timedOut: () => timedOut,
            emit,
          });
          billedTokens = reportedTokens(outcome.usage) + outcome.estimatedTokens;
          options.log?.({
            event: "generation",
            requestId: request.requestId,
            intent: request.intent,
            provider: options.provider.id,
            model: options.provider.model,
            configurationId: options.provider.configurationId,
            outcome: outcome.outcome,
            errorCode: outcome.errorCode,
            calls: outcome.calls,
            repairAttempts: outcome.repairAttempts,
            latencyMs: now() - startedAt,
            ...outcome.usage,
            ...(outcome.estimatedTokens > 0 ? { estimatedTokens: outcome.estimatedTokens } : {}),
          });
        } finally {
          clearInterval(keepAlive);
          clearTimeout(timeout);
          active.delete(request.requestId);
          admission.release(billedTokens);
        }
      });
    },
  );

  // A chat turn shares the generation limiter, so a chat and a canvas action
  // can never run at once and both count against the same daily budget.
  app.post(
    "/api/ai/chat",
    bodyLimit({
      maxSize: MAX_CHAT_REQUEST_BYTES,
      onError: (c) => jsonError(c, 413, "request_too_large", "The question and its sources are too large to send"),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return jsonError(c, 400, "invalid_request", "The request body must be JSON");
      }
      const parsed = ChatRequestSchema.safeParse(body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return jsonError(c, 400, "invalid_request", `${issue.path.join(".") || "request"}: ${issue.message}`);
      }
      const request = parsed.data;

      const admission = options.limiter.admit(request.requestId);
      if (!admission.ok) return jsonError(c, admission.status, admission.code, admission.message, admission.code !== "duplicate_request");

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.generationTimeoutMs);
      active.set(request.requestId, controller);
      const startedAt = now();

      return streamSSE(c, async (stream) => {
        stream.onAbort(() => controller.abort());
        const keepAlive = setInterval(() => {
          void stream.write(": keep-alive\n\n");
        }, options.keepAliveMs ?? 15_000);
        const emit = async (event: ChatEvent) => {
          if (stream.aborted) return;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        };
        let billedTokens = 0;
        let outcome: GenerationLogRecord["outcome"] = "answer";
        let errorCode: GatewayErrorCode | undefined;
        let usage: UsageReport = {};
        let estimatedTokens = 0;
        try {
          await emit({ type: "started", requestId: request.requestId, provider: options.provider.id, model: options.provider.model });
          const result = await options.provider.chat({
            request,
            signal: controller.signal,
            onDelta: (text) => emit({ type: "delta", text }),
          });
          usage = result.usage ?? {};
          billedTokens = reportedTokens(result.usage);
          if (result.usage) await emit({ type: "usage", usage: result.usage });
          await emit({ type: "complete" });
        } catch (error) {
          outcome = "error";
          if (error instanceof ProviderError) {
            usage = error.usage ?? {};
            estimatedTokens = error.estimatedTokens;
            billedTokens = reportedTokens(error.usage) + estimatedTokens;
          }
          let code: GatewayErrorCode = "provider_unavailable";
          let message = "The AI provider failed unexpectedly";
          let retryable = true;
          if (controller.signal.aborted) {
            code = timedOut ? "timeout" : "cancelled";
            message = timedOut ? "The answer took too long and was stopped" : "The answer was cancelled";
            retryable = timedOut;
          } else if (error instanceof ProviderError) {
            ({ code, message, retryable } = error);
          }
          errorCode = code;
          await emit({ type: "error", code, message, retryable });
        } finally {
          clearInterval(keepAlive);
          clearTimeout(timeout);
          active.delete(request.requestId);
          admission.release(billedTokens);
          options.log?.({
            event: "generation",
            requestId: request.requestId,
            intent: "chat",
            provider: options.provider.id,
            model: options.provider.model,
            configurationId: options.provider.chatConfigurationId,
            outcome,
            errorCode,
            calls: 1,
            repairAttempts: 0,
            latencyMs: now() - startedAt,
            ...usage,
            ...(estimatedTokens > 0 ? { estimatedTokens } : {}),
          });
        }
      });
    },
  );

  app.post("/api/ai/cancel", bodyLimit({ maxSize: 1_024 }), async (c) => {
    const body = await c.req.json().catch(() => undefined) as { requestId?: unknown } | undefined;
    if (typeof body?.requestId !== "string") return jsonError(c, 400, "invalid_request", "requestId is required");
    const controller = active.get(body.requestId);
    if (!controller) return c.json({ cancelled: false });
    controller.abort();
    return c.json({ cancelled: true });
  });

  app.notFound((c) => jsonError(c, 404, "invalid_request", "Not found"));
  return app;
}
