import { describe, expect, it, vi } from "vitest";
import type { GatewayEvent, GenerateRequest } from "@ai-notebook/ai-contract";
import { cancelGeneration, createSseParser, fetchCapabilities, GatewayError, streamGeneration } from "./gatewayClient";

const request: GenerateRequest = {
  requestId: "request-abcdefgh",
  pageId: "page-1",
  intent: "teach_section",
  permittedOperations: ["insert_lesson_section"],
  maxOperations: 1,
  targets: [],
  context: [],
};

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

const sseResponse = (chunks: string[]) => new Response(streamOf(chunks), { status: 200, headers: { "Content-Type": "text/event-stream" } });

const collect = async (chunks: string[]) => {
  const events: GatewayEvent[] = [];
  await streamGeneration(request, { fetchImpl: async () => sseResponse(chunks), onEvent: (event) => events.push(event) });
  return events;
};

describe("SSE parsing", () => {
  it("reads events split across chunk boundaries", () => {
    const seen: Array<[string, string]> = [];
    const parser = createSseParser((name, data) => seen.push([name, data]));
    parser.push("event: pro");
    parser.push("gress\ndata: {\"a\":1}");
    parser.push("\n\nevent: complete\ndata: {}\n\n");
    parser.end();
    expect(seen).toEqual([
      ["progress", "{\"a\":1}"],
      ["complete", "{}"],
    ]);
  });

  it("skips keep-alive comments and joins multi-line data", () => {
    const seen: Array<[string, string]> = [];
    const parser = createSseParser((name, data) => seen.push([name, data]));
    parser.push(": keep-alive\n\nevent: proposal\ndata: line one\ndata: line two\n\n");
    parser.end();
    expect(seen).toEqual([["proposal", "line one\nline two"]]);
  });

  it("accepts CRLF line endings and a final block without a blank line", () => {
    const seen: Array<[string, string]> = [];
    const parser = createSseParser((name, data) => seen.push([name, data]));
    parser.push("event: usage\r\ndata: {}\r\n");
    parser.end();
    expect(seen).toEqual([["usage", "{}"]]);
  });
});

describe("gateway client", () => {
  it("delivers the events of a generation in order", async () => {
    const events = await collect([
      "event: started\ndata: {\"type\":\"started\",\"requestId\":\"r\",\"provider\":\"mock\",\"model\":\"m\",\"configurationId\":\"c\",\"mode\":\"mock\"}\n\n",
      ": keep-alive\n\n",
      "event: progress\ndata: {\"type\":\"progress\",\"phase\":\"validating\"}\n\n",
      "event: complete\ndata: {\"type\":\"complete\"}\n\n",
    ]);
    expect(events.map((event) => event.type)).toEqual(["started", "progress", "complete"]);
  });

  it("ignores events it does not recognise instead of passing them on", async () => {
    const events = await collect([
      "event: surprise\ndata: {\"type\":\"surprise\"}\n\n",
      "event: complete\ndata: {\"type\":\"complete\"}\n\n",
    ]);
    expect(events.map((event) => event.type)).toEqual(["complete"]);
  });

  it("turns a refused request into a typed error with a readable message", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ type: "error", code: "busy", message: "raw", retryable: true }), { status: 429 });
    await expect(streamGeneration(request, { fetchImpl, onEvent: () => undefined })).rejects.toMatchObject({
      name: "GatewayError",
      code: "busy",
      retryable: true,
      message: expect.stringContaining("already working"),
    });
  });

  it("reports a missing token as unauthorized even without a parsable body", async () => {
    const fetchImpl = async () => new Response("no", { status: 401 });
    const error = await streamGeneration(request, { fetchImpl, onEvent: () => undefined }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).code).toBe("unauthorized");
    expect((error as GatewayError).retryable).toBe(false);
  });

  it("blames the gateway, not DeepSeek, when the gateway itself does not answer", async () => {
    // What a development or reverse proxy returns when the gateway is down.
    const fetchImpl = async () => new Response("ECONNREFUSED", { status: 502 });
    const error = (await streamGeneration(request, { fetchImpl, onEvent: () => undefined }).catch((value: unknown) => value)) as GatewayError;
    expect(error.code).toBe("provider_unavailable");
    expect(error.message).toMatch(/gateway did not answer \(502\)/);
    expect(error.message).not.toMatch(/DeepSeek/);
    // Worth trying again once the gateway is back.
    expect(error.retryable).toBe(true);
  });

  it("sends the access token and asks for the gateway's capabilities", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ provider: "mock" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const capabilities = await fetchCapabilities({ fetchImpl: fetchImpl as unknown as typeof fetch, accessToken: "token" });
    expect(capabilities.provider).toBe("mock");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("asks the gateway to stop a generation, and survives a gateway that cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    await expect(cancelGeneration("request-abcdefgh", { fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toBe(true);
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)) as { requestId: string };
    expect(body.requestId).toBe("request-abcdefgh");

    const failing = async () => {
      throw new Error("offline");
    };
    await expect(cancelGeneration("request-abcdefgh", { fetchImpl: failing as unknown as typeof fetch })).resolves.toBe(false);
  });
});
