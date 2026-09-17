import type { GenerateRequest } from "@ai-notebook/ai-contract";

export function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

export function sseChunks(events: unknown[], options: { done?: boolean } = {}): string[] {
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  if (options.done ?? true) lines.push("data: [DONE]\n\n");
  return lines;
}

export const sampleRequest = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  requestId: "request-0001",
  pageId: "page-1",
  intent: "explain_selection",
  permittedOperations: ["insert_explanation"],
  maxOperations: 1,
  targets: [],
  context: [{ kind: "text", id: "note-1", revision: 2, title: "Momentum", body: "SECRET-NOTE-BODY p = mv" }],
  ...overrides,
});

export const validExplanation = JSON.stringify({
  schemaVersion: 1,
  operations: [{
    type: "insert_explanation",
    localId: "why",
    anchor: { relation: "below_selection" },
    content: { kind: "text", title: "Why momentum is conserved", body: "No external impulse acts on the system." },
  }],
});
