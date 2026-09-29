import { describe, expect, it, vi } from "vitest";
import { mockLessonProposal, type GatewayEvent } from "@ai-notebook/ai-contract";
import type { NotebookObject } from "../domain/notebook";
import { requestAiDraft, type AiDraftPhase } from "./aiSession";

const source: NotebookObject = {
  id: "source",
  revision: 4,
  kind: "text-card",
  x: 20,
  y: 20,
  width: 200,
  height: 100,
  title: "Vectors",
  body: "A vector has size and direction.",
};

// A proposal arrives as untrusted JSON, so these tests describe one the way the
// wire does rather than as an already-valid CanvasProposal.
type TestEvent = Exclude<GatewayEvent, { type: "proposal" }> | { type: "proposal"; proposal: unknown; repairAttempts: number };

const encoder = new TextEncoder();

const sseFrom = (events: TestEvent[]) =>
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");

function fetchReturning(events: TestEvent[], onRequest?: (body: unknown) => void) {
  return async (_url: string, init?: RequestInit) => {
    onRequest?.(JSON.parse(String(init?.body)));
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sseFrom(events)));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };
}

const started: TestEvent = { type: "started", requestId: "r", provider: "mock", model: "deterministic-fixture", configurationId: "mock-v1", mode: "mock" };
const complete: TestEvent = { type: "complete" };

const run = (events: TestEvent[], overrides: Partial<Parameters<typeof requestAiDraft>[0]> = {}, onRequest?: (body: unknown) => void) => {
  let nextId = 0;
  return requestAiDraft({
    pageId: "page-1",
    intent: "teach_section",
    objects: [source],
    selectedIds: new Set(["source"]),
    selectionBounds: { x: 20, y: 20, width: 200, height: 100 },
    viewportCenter: { x: 640, y: 400 },
    requestId: "request-abcdefgh",
    transactionId: "transaction-1",
    idFactory: () => `generated-${++nextId}`,
    fetchImpl: fetchReturning(events, onRequest) as unknown as typeof fetch,
    ...overrides,
  });
};

describe("AI session", () => {
  it("turns a streamed proposal into a draft that is not yet on the page", async () => {
    const phases: AiDraftPhase[] = [];
    const outcome = await run(
      [started, { type: "progress", phase: "generating" }, { type: "proposal", proposal: mockLessonProposal, repairAttempts: 0 }, { type: "usage", usage: { promptTokens: 120, completionTokens: 400 }, calls: 1 }, complete],
      { onPhase: (phase) => phases.push(phase) },
    );
    expect(outcome.status).toBe("draft");
    if (outcome.status !== "draft") return;
    expect(outcome.batch.inserts.length).toBeGreaterThan(0);
    expect(outcome.batch.provenance).toMatchObject({
      requestId: "request-abcdefgh",
      intent: "teach_section",
      provider: "mock",
      model: "deterministic-fixture",
      sources: [{ id: "source", revision: 4, selected: true }],
    });
    // Each source carries a fingerprint of its content as sent, so a later edit can mark the result stale.
    expect(outcome.batch.provenance.sources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.usage).toEqual({ promptTokens: 120, completionTokens: 400 });
    expect(phases).toEqual(["sending", "generating", "generating", "preparing"]);
  });

  it("sends only what this action permits", async () => {
    let sent: unknown;
    await run([started, { type: "proposal", proposal: mockLessonProposal, repairAttempts: 0 }, complete], {}, (body) => {
      sent = body;
    });
    expect(sent).toMatchObject({
      pageId: "page-1",
      intent: "teach_section",
      permittedOperations: ["insert_lesson_section"],
      targets: [],
    });
  });

  it("refuses a proposal that goes beyond the action, even though the gateway accepted it", async () => {
    // A well-formed proposal whose operation this action never asked for.
    const overreaching = {
      schemaVersion: 1,
      operations: [
        {
          type: "insert_quiz",
          localId: "q1",
          anchor: { relation: "viewport_center" },
          content: {
            kind: "quiz",
            prompt: "Which one?",
            options: [
              { localId: "a", label: "A" },
              { localId: "b", label: "B" },
            ],
            correctOptionLocalId: "a",
            rationale: "Because A.",
            conceptTags: ["forces"],
          },
        },
      ],
    };
    const outcome = await run([started, { type: "proposal", proposal: overreaching, repairAttempts: 0 }, complete]);
    expect(outcome).toMatchObject({ status: "error", code: "invalid_proposal" });
  });

  it("reports a gateway error event with a readable message", async () => {
    const outcome = await run([started, { type: "error", code: "provider_balance", message: "Insufficient Balance", retryable: false }]);
    expect(outcome).toMatchObject({ status: "error", code: "provider_balance", retryable: false });
    if (outcome.status !== "error") return;
    expect(outcome.message).toMatch(/balance/i);
  });

  it("reports a stream that ends without a proposal", async () => {
    const outcome = await run([started, complete]);
    expect(outcome).toMatchObject({ status: "error", code: "empty_output", retryable: true });
  });

  it("refuses an action that needs a selection, without contacting the gateway", async () => {
    const fetchImpl = vi.fn();
    const outcome = await requestAiDraft({
      pageId: "page-1",
      intent: "explain_selection",
      objects: [source],
      selectedIds: new Set(),
      viewportCenter: { x: 0, y: 0 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(outcome).toMatchObject({ status: "error", code: "local", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports cancellation, and asks the gateway to stop the generation", async () => {
    const controller = new AbortController();
    const cancelCalls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/ai/cancel")) {
        cancelCalls.push(String(init?.body));
        return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
      }
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    const outcome = await run([], { signal: controller.signal, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome).toEqual({ status: "cancelled" });
    await vi.waitFor(() => expect(cancelCalls).toHaveLength(1));
    expect(cancelCalls[0]).toContain("request-abcdefgh");
  });

  it("reports an unreachable gateway as retryable", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await run([], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome).toMatchObject({ status: "error", code: "provider_unavailable", retryable: true });
  });
});
