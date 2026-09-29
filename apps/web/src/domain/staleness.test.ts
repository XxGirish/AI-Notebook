import { describe, expect, it } from "vitest";
import type { AiTransactionRecord, NotebookObject, TextCardObject } from "./notebook";
import { contentHashOf, findStaleGeneratedObjects, selectedSourceIds, semanticContentOf, withContentHashes } from "./staleness";

const card = (id: string, body: string, extra: Partial<TextCardObject> = {}): TextCardObject => ({
  id, revision: 1, kind: "text-card", x: 0, y: 0, width: 200, height: 100, title: "Note", body, ...extra,
});

const transaction = (sources: AiTransactionRecord["sources"], generatedObjectIds: string[]): AiTransactionRecord => ({
  transactionId: "t", requestId: "r", intent: "explain_selection", provider: "mock", model: "m", configurationId: "c",
  proposalSchemaVersion: 1, sources, committedAt: 1, generatedObjectIds, updatedObjectIds: [],
});

async function hashLookup(objects: NotebookObject[]) {
  const hashes = new Map(await Promise.all(objects.map(async (object) => [object.id, await contentHashOf(object)] as const)));
  return (object: NotebookObject) => hashes.get(object.id);
}

describe("stale generated content", () => {
  it("ignores geometry, identity and key order when fingerprinting meaning", async () => {
    const original = card("a", "Force is mass times acceleration");
    const moved = { ...original, x: 500, y: 90, width: 300, revision: 4, groupId: "g" };
    const reordered = { body: original.body, title: original.title, kind: original.kind, id: "other", revision: 1, x: 0, y: 0, width: 1, height: 1 } as TextCardObject;
    expect(semanticContentOf(moved)).toBe(semanticContentOf(original));
    expect(await contentHashOf(reordered)).toBe(await contentHashOf(original));
    expect(await contentHashOf({ ...original, body: "Force is rate of change of momentum" })).not.toBe(await contentHashOf(original));
  });

  it("flags an explanation when its selected note is edited or deleted, but not when it is moved", async () => {
    const source = card("source", "Newton's second law");
    const explanation = card("explanation", "It says F = ma.");
    const [hashed] = await withContentHashes([{ id: "source", revision: 1, selected: true }], [source]);
    const record = transaction([hashed], ["explanation"]);

    const moved = [{ ...source, x: 400, revision: 2 }, explanation];
    expect(findStaleGeneratedObjects(moved, [record], await hashLookup(moved)).size).toBe(0);

    const edited = [{ ...source, body: "Newton's third law", revision: 3 }, explanation];
    expect(findStaleGeneratedObjects(edited, [record], await hashLookup(edited))).toEqual(new Map([["explanation", { reason: "source-changed", sourceIds: ["source"] }]]));

    expect(findStaleGeneratedObjects([explanation], [record], await hashLookup([explanation]))).toEqual(new Map([["explanation", { reason: "source-deleted", sourceIds: [] }]]));
  });

  it("does not flag for changes to nearby context that was not selected, or for records without hashes", async () => {
    const selected = card("selected", "Chosen");
    const nearby = card("nearby", "Context");
    const explanation = card("explanation", "Answer");
    const sources = await withContentHashes([{ id: "selected", revision: 1, selected: true }, { id: "nearby", revision: 1 }], [selected, nearby]);
    const afterNearbyEdit = [selected, { ...nearby, body: "Changed context" }, explanation];
    expect(findStaleGeneratedObjects(afterNearbyEdit, [transaction(sources, ["explanation"])], await hashLookup(afterNearbyEdit)).size).toBe(0);

    const legacy = transaction([{ id: "selected", revision: 1 }], ["explanation"]);
    expect(findStaleGeneratedObjects([explanation], [legacy], () => undefined).size).toBe(0);
    expect(selectedSourceIds([transaction(sources, []), legacy])).toEqual(new Set(["selected"]));
  });

  it("treats a hash still being computed as not stale, and skips generated objects already removed", async () => {
    const source = card("source", "Text");
    const [hashed] = await withContentHashes([{ id: "source", revision: 1, selected: true }], [source]);
    const record = transaction([hashed], ["gone", "explanation"]);
    const objects = [{ ...source, body: "Edited" }, card("explanation", "x")];
    expect(findStaleGeneratedObjects(objects, [record], () => undefined).size).toBe(0);
    expect([...findStaleGeneratedObjects(objects, [record], await hashLookup(objects)).keys()]).toEqual(["explanation"]);
  });
});
