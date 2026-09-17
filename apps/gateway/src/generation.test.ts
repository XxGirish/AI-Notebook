import type { GatewayEvent } from "@ai-notebook/ai-contract";
import { describe, expect, it } from "vitest";
import { runGeneration } from "./generation";
import { MockProvider } from "./providers/mockProvider";
import { ProviderError } from "./providers/types";
import { sampleRequest, validExplanation } from "./testSupport";

async function run(provider: MockProvider, request = sampleRequest(), signal = new AbortController().signal, timedOut = false) {
  const events: GatewayEvent[] = [];
  const outcome = await runGeneration({ request, provider, signal, timedOut: () => timedOut, emit: (event) => { events.push(event); } });
  return { outcome, events };
}

describe("generation service", () => {
  it("emits started, a validated proposal, usage, and complete", async () => {
    const { outcome, events } = await run(new MockProvider({ script: [validExplanation] }));
    expect(events.map((event) => event.type)).toEqual(["started", "progress", "progress", "usage", "proposal", "complete"]);
    expect(outcome).toMatchObject({ outcome: "proposal", calls: 1, repairAttempts: 0 });
  });

  it("repairs one invalid proposal and sends the rejection reasons back", async () => {
    const invalid = JSON.stringify({ schemaVersion: 1, operations: [{ type: "insert_quiz", localId: "q", anchor: { relation: "below_selection" }, content: { kind: "text", title: "x", body: "y" } }] });
    const provider = new MockProvider({ script: [invalid, validExplanation] });
    const calls: unknown[] = [];
    const original = provider.generate.bind(provider);
    provider.generate = async (call) => {
      calls.push(call.repair);
      return original(call);
    };
    const { outcome, events } = await run(provider);
    expect(outcome).toMatchObject({ outcome: "proposal", calls: 2, repairAttempts: 1 });
    expect(calls[0]).toBeUndefined();
    expect(calls[1]).toMatchObject({ previousOutput: invalid });
    expect(events.find((event) => event.type === "proposal")).toMatchObject({ repairAttempts: 1 });
  });

  it("stops after one failed repair without emitting a proposal", async () => {
    const { outcome, events } = await run(new MockProvider({ script: ["not json", "{\"schemaVersion\":2}"] }));
    expect(outcome).toMatchObject({ outcome: "error", errorCode: "invalid_proposal", calls: 2 });
    expect(events.some((event) => event.type === "proposal")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "invalid_proposal", retryable: true });
  });

  it("rejects operations and update targets the request did not permit", async () => {
    const update = JSON.stringify({ schemaVersion: 1, operations: [{ type: "propose_object_update", targetId: "note-1", expectedRevision: 2, content: { kind: "text", title: "Replaced", body: "Replaced" } }] });
    const { outcome } = await run(new MockProvider({ script: [update, update] }));
    expect(outcome.errorCode).toBe("invalid_proposal");
  });

  it("reports empty output distinctly and passes provider errors through", async () => {
    expect((await run(new MockProvider({ script: ["", ""] }))).outcome.errorCode).toBe("empty_output");
    const failed = await run(new MockProvider({ script: [new ProviderError("provider_balance", "No balance", false)] }));
    expect(failed.outcome).toMatchObject({ errorCode: "provider_balance", calls: 1 });
    expect(failed.events.at(-1)).toMatchObject({ type: "error", retryable: false });
  });

  it("distinguishes a timeout from a client cancellation", async () => {
    const aborted = new AbortController();
    aborted.abort();
    expect((await run(new MockProvider(), sampleRequest(), aborted.signal, true)).outcome.errorCode).toBe("timeout");
    expect((await run(new MockProvider(), sampleRequest(), aborted.signal, false)).outcome.errorCode).toBe("cancelled");
  });

  it("produces a valid deterministic fixture for every intent", async () => {
    const intents = [
      ["teach_section", "insert_lesson_section"],
      ["explain_selection", "insert_explanation"],
      ["create_diagram", "insert_diagram"],
      ["create_equation", "insert_equation"],
      ["create_quiz", "insert_quiz"],
    ] as const;
    for (const [intent, operation] of intents) {
      const { outcome } = await run(new MockProvider(), sampleRequest({ intent, permittedOperations: [operation] }));
      expect(outcome.outcome, intent).toBe("proposal");
    }
  });
});
