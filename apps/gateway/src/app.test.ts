import { describe, expect, it } from "vitest";
import { createGatewayApp, type GenerationLogRecord } from "./app";
import { GenerationLimiter } from "./limits";
import { MockProvider } from "./providers/mockProvider";
import { sampleRequest, validExplanation } from "./testSupport";

const token = "access-token-".padEnd(40, "x");

function appWith(provider = new MockProvider({ script: [validExplanation] }), extra: { timeoutMs?: number } = {}) {
  const logs: GenerationLogRecord[] = [];
  const app = createGatewayApp({
    provider,
    limiter: new GenerationLimiter({ requestsPerMinute: 10, dailyRequests: 100, dailyTokens: 100_000 }),
    accessToken: token,
    generationTimeoutMs: extra.timeoutMs ?? 5_000,
    log: (record) => logs.push(record),
  });
  return { app, logs };
}

const post = (app: ReturnType<typeof appWith>["app"], path: string, body: unknown, auth = token) => app.request(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

function sseEvents(text: string) {
  return text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    return data ? [JSON.parse(data.slice(6)) as { type: string; [key: string]: unknown }] : [];
  });
}

describe("gateway HTTP API", () => {
  it("serves health publicly but protects AI routes with the access token", async () => {
    const { app } = appWith();
    expect(await (await app.request("/api/health")).json()).toEqual({ ok: true });
    expect((await app.request("/api/ai/capabilities")).status).toBe(401);
    expect((await app.request("/api/ai/capabilities", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const capabilities = await app.request("/api/ai/capabilities", { headers: { Authorization: `Bearer ${token}` } });
    expect(capabilities.status).toBe(200);
    expect(capabilities.headers.get("Cache-Control")).toBe("no-store");
    expect(await capabilities.json()).toMatchObject({ provider: "mock", imageInput: "unverified" });
  });

  it("streams a validated proposal and logs only redacted metadata", async () => {
    const { app, logs } = appWith();
    const response = await post(app, "/api/ai/generate", sampleRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const events = sseEvents(await response.text());
    expect(events.map((event) => event.type)).toEqual(["started", "progress", "progress", "usage", "proposal", "complete"]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "generation", outcome: "proposal", intent: "explain_selection", calls: 1 });
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain("SECRET-NOTE-BODY");
    expect(logged).not.toContain("Why momentum");
    expect(logged).not.toContain(token);
  });

  it("rejects malformed, oversized, and replayed requests before calling the provider", async () => {
    const provider = new MockProvider({ script: [validExplanation] });
    let calls = 0;
    const original = provider.generate.bind(provider);
    provider.generate = (call) => {
      calls += 1;
      return original(call);
    };
    const { app } = appWith(provider);
    expect((await post(app, "/api/ai/generate", "{not json")).status).toBe(400);
    expect((await post(app, "/api/ai/generate", { ...sampleRequest(), extra: true })).status).toBe(400);
    const huge = sampleRequest({ context: Array.from({ length: 20 }, (_, index) => ({ kind: "text" as const, id: `n${index}`, revision: 1, title: "t", body: "x".repeat(7_000) })) });
    const tooLarge = await post(app, "/api/ai/generate", huge);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ code: "request_too_large" });
    expect(calls).toBe(0);

    await (await post(app, "/api/ai/generate", sampleRequest())).text();
    const replay = await post(app, "/api/ai/generate", sampleRequest());
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: "duplicate_request" });
    expect(calls).toBe(1);
  });

  it("refuses a second concurrent generation and cancels the running one on request", async () => {
    const { app, logs } = appWith(new MockProvider({ delayMs: 2_000 }));
    const running = post(app, "/api/ai/generate", sampleRequest({ requestId: "request-slow" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await post(app, "/api/ai/generate", sampleRequest({ requestId: "request-other" }));
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ code: "busy" });

    expect(await (await post(app, "/api/ai/cancel", { requestId: "request-slow" })).json()).toEqual({ cancelled: true });
    const events = sseEvents(await (await running).text());
    expect(events.at(-1)).toMatchObject({ type: "error", code: "cancelled", retryable: false });
    expect(events.some((event) => event.type === "proposal")).toBe(false);
    expect(logs[0]).toMatchObject({ outcome: "error", errorCode: "cancelled" });

    const after = await post(app, "/api/ai/generate", sampleRequest({ requestId: "request-after" }));
    expect(after.status).toBe(200);
    await after.body?.cancel();
  });

  it("stops generation at the server timeout", async () => {
    const { app } = appWith(new MockProvider({ delayMs: 2_000 }), { timeoutMs: 50 });
    const events = sseEvents(await (await post(app, "/api/ai/generate", sampleRequest())).text());
    expect(events.at(-1)).toMatchObject({ type: "error", code: "timeout", retryable: true });
  });
});
