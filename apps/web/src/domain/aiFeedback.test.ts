import { describe, expect, it } from "vitest";
import { createAiFeedback, generatingTransactions, MAX_FEEDBACK_NOTE } from "./aiFeedback";
import type { AiTransactionRecord } from "./notebook";

const transaction: AiTransactionRecord = {
  transactionId: "tx", requestId: "req", intent: "explain_selection", provider: "deepseek", model: "deepseek-flash", configurationId: "cfg",
  proposalSchemaVersion: 1, sources: [], committedAt: 1, generatedObjectIds: ["a", "b"], updatedObjectIds: [],
};

describe("AI feedback", () => {
  it("records the request and model that produced the content, with a snapshot of it", () => {
    const report = createAiFeedback({
      id: "f1", pageId: "page", object: { id: "a", revision: 3 }, transaction, reason: "incorrect",
      note: "  The sign is wrong.  ", contentSnapshot: "F = -ma", createdAt: 10,
    });
    expect(report).toEqual({
      id: "f1", pageId: "page", objectId: "a", objectRevision: 3, transactionId: "tx", requestId: "req", intent: "explain_selection",
      provider: "deepseek", model: "deepseek-flash", configurationId: "cfg", reason: "incorrect", note: "The sign is wrong.", contentSnapshot: "F = -ma", createdAt: 10,
    });
  });

  it("drops an empty note and bounds a long one", () => {
    const base = { id: "f", pageId: "p", object: { id: "a", revision: 1 }, transaction, reason: "other" as const, contentSnapshot: "x", createdAt: 1 };
    expect(createAiFeedback({ ...base, note: "   " })).not.toHaveProperty("note");
    expect(createAiFeedback({ ...base, note: "n".repeat(5_000) }).note).toHaveLength(MAX_FEEDBACK_NOTE);
  });

  it("maps each generated object to the transaction that made it", () => {
    const later = { ...transaction, transactionId: "tx2", generatedObjectIds: ["c"] };
    const byObject = generatingTransactions([transaction, later]);
    expect(byObject.get("b")?.transactionId).toBe("tx");
    expect(byObject.get("c")?.transactionId).toBe("tx2");
    expect(byObject.has("user-note")).toBe(false);
  });
});
