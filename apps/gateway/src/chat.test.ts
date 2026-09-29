import { describe, expect, it } from "vitest";
import { citedPassageIds, type ChatRequest } from "@ai-notebook/ai-contract";
import { createGatewayApp, type GenerationLogRecord } from "./app";
import { GenerationLimiter } from "./limits";
import { buildChatRequestBody } from "./providers/deepseek/deepseekProvider";
import { MockProvider } from "./providers/mockProvider";
import { ProviderError } from "./providers/types";
import { sampleRequest } from "./testSupport";

const token = "access-token-".padEnd(40, "x");

const chatRequest = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  requestId: "chat-request-0001",
  messages: [{ role: "user", content: "What is momentum?" }],
  passages: [{ id: "S1", origin: "physics.pdf", locator: "p. 3", text: "SECRET-PASSAGE Momentum p = mv." }],
  ...overrides,
});

function appWith(provider = new MockProvider()) {
  const logs: GenerationLogRecord[] = [];
  const app = createGatewayApp({
    provider,
    limiter: new GenerationLimiter({ requestsPerMinute: 10, dailyRequests: 100, dailyTokens: 100_000 }),
    accessToken: token,
    generationTimeoutMs: 5_000,
    log: (record) => logs.push(record),
  });
  const post = (body: unknown) => app.request("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { app, logs, post };
}

function sseEvents(text: string) {
  return text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    return data ? [JSON.parse(data.slice(6)) as { type: string; [key: string]: unknown }] : [];
  });
}

describe("chat route", () => {
  it("streams an answer in pieces and logs only redacted metadata", async () => {
    const { post, logs } = appWith();
    const response = await post(chatRequest());
    expect(response.status).toBe(200);
    const events = sseEvents(await response.text());
    expect(events[0]).toMatchObject({ type: "started", provider: "mock" });
    const deltas = events.filter((event) => event.type === "delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => event.text).join("")).toContain("[S1]");
    expect(events.at(-1)).toEqual({ type: "complete" });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ intent: "chat", outcome: "answer", configurationId: "mock-chat-v1" });
    expect(JSON.stringify(logs)).not.toContain("SECRET-PASSAGE");
  });

  it("rejects a conversation that does not end with the user's question", async () => {
    const { post } = appWith();
    const response = await post(chatRequest({ messages: [{ role: "assistant", content: "Hello" }] }));
    expect(response.status).toBe(400);
  });

  it("rejects duplicate passage labels and unknown fields", async () => {
    const { post } = appWith();
    const passage = chatRequest().passages[0];
    expect((await post(chatRequest({ passages: [passage, passage] }))).status).toBe(400);
    expect((await post({ ...chatRequest(), extra: true })).status).toBe(400);
  });

  it("reports a provider failure as an error event and releases the in-flight slot", async () => {
    const provider = new MockProvider({ chatScript: [new ProviderError("provider_rate_limited", "busy upstream", true)] });
    const { post } = appWith(provider);
    const events = sseEvents(await (await post(chatRequest())).text());
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider_rate_limited", retryable: true });
    const second = await post(chatRequest({ requestId: "chat-request-0002" }));
    expect(second.status).toBe(200);
  });

  it("requires the access token", async () => {
    const { app } = appWith();
    const response = await app.request("/api/ai/chat", { method: "POST", body: JSON.stringify(chatRequest()) });
    expect(response.status).toBe(401);
  });
});

describe("chat request body", () => {
  it("puts passages ahead of the conversation, disables thinking, and asks for no tool", () => {
    const body = buildChatRequestBody("deepseek-flash", 2_000, { request: chatRequest() });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("[S1] (physics.pdf, p. 3)");
    expect(messages.at(-1)).toEqual({ role: "user", content: "What is momentum?" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("response_format");
  });
});

describe("citations", () => {
  it("keeps only labels that were sent, once each, in order of use", () => {
    expect(citedPassageIds("A [S2] and B [S1][S2] and C [S9]", ["S1", "S2"])).toEqual(["S2", "S1"]);
  });
});

describe("daily budget for failed calls", () => {
  /** A provider whose every call fails the way a cancelled DeepSeek stream does. */
  const failingProvider = () => {
    const provider = new MockProvider();
    const fail = async () => {
      const error = new ProviderError("provider_unavailable", "The DeepSeek stream ended before completion", true);
      error.estimatedTokens = 500;
      throw error;
    };
    provider.chat = fail;
    provider.generate = fail;
    return provider;
  };

  function appWithBudget(dailyTokens: number) {
    const logs: GenerationLogRecord[] = [];
    const app = createGatewayApp({
      provider: failingProvider(),
      limiter: new GenerationLimiter({ requestsPerMinute: 10, dailyRequests: 100, dailyTokens }),
      accessToken: token,
      generationTimeoutMs: 5_000,
      log: (record) => logs.push(record),
    });
    const post = (path: string, body: unknown) => app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { logs, post };
  }

  it("charges a failed chat's estimated tokens, so repeated cancels cannot spend past the budget", async () => {
    const { logs, post } = appWithBudget(400);
    await (await post("/api/ai/chat", chatRequest({ requestId: "chat-request-a" }))).text();
    expect(logs[0]).toMatchObject({ outcome: "error", estimatedTokens: 500 });
    const next = await post("/api/ai/chat", chatRequest({ requestId: "chat-request-b" }));
    expect(next.status).toBe(429);
    expect(await next.json()).toMatchObject({ code: "budget_exhausted" });
  });

  it("charges a failed canvas generation the same way", async () => {
    const { logs, post } = appWithBudget(400);
    await (await post("/api/ai/generate", sampleRequest({ requestId: "generate-request-a" }))).text();
    expect(logs[0]).toMatchObject({ outcome: "error", estimatedTokens: 500 });
    const next = await post("/api/ai/generate", sampleRequest({ requestId: "generate-request-b" }));
    expect(await next.json()).toMatchObject({ code: "budget_exhausted" });
  });
});
