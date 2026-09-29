import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ImageObject, InkTextObject } from "../domain/notebook";
import { pageFromFixture } from "../domain/pages";
import { phaseZeroFixture } from "../fixtures/phaseZeroFixture";
import type { ArchivedSource } from "./archiveLibrary";
import type { AssetRecord, ChatMessageRecord } from "./notebookDatabase";
import type { QuizAttemptRecord } from "../domain/quizAttempts";
import { createNotebookArchive, readNotebookArchive } from "./notebookArchive";

async function assetRecord(bytes: Uint8Array, mimeType = "image/png"): Promise<AssetRecord> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { hash, blob: new Blob([source], { type: mimeType }), mimeType, size: bytes.length, createdAt: 10 };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe(".ainotebook archives", () => {
  it("round-trips pages and assets while remapping every relationship id", async () => {
    const asset = await assetRecord(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    const page = pageFromFixture(phaseZeroFixture, 100);
    page.objects = page.objects.map((object) => object.id === "node-force" ? { ...object, groupId: "group-original" } : object);
    page.objects.push({
      id: "image-original",
      revision: 1,
      kind: "image",
      assetHash: asset.hash,
      mimeType: asset.mimeType,
      name: "diagram.png",
      x: 100,
      y: 200,
      width: 320,
      height: 180,
      groupId: "group-original",
    } satisfies ImageObject);
    page.aiTransactions.push({
      transactionId: "transaction-original",
      requestId: "request-original",
      intent: "create_diagram",
      provider: "mock",
      model: "fixture-v1",
      configurationId: "mock-v1",
      proposalSchemaVersion: 1,
      sources: [{ id: "node-force", revision: 1 }, { id: "deleted-source", revision: 2, contentHash: "b".repeat(64) }],
      committedAt: 90,
      generatedObjectIds: ["node-acceleration"],
      updatedObjectIds: [],
    });

    const archive = await createNotebookArchive([page], [asset], "2026-09-15T00:00:00.000Z");
    let nextId = 0;
    const imported = await readNotebookArchive(archive, { now: 1_000, idFactory: () => `copy-${++nextId}` });

    expect(imported.pages).toHaveLength(1);
    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0]).toMatchObject({ hash: asset.hash, mimeType: "image/png", size: 7 });
    expect(imported.pages[0].id).not.toBe(page.id);
    expect(imported.pages[0].objects.map((object) => object.id)).not.toContain("node-force");

    const importedConnector = imported.pages[0].objects.find((object) => object.kind === "connector" && object.label === "increases");
    const importedForce = imported.pages[0].objects.find((object) => object.kind === "graph-node" && object.label === "Net force");
    const importedAcceleration = imported.pages[0].objects.find((object) => object.kind === "graph-node" && object.label === "Acceleration");
    expect(importedConnector).toMatchObject({ fromId: importedForce?.id, toId: importedAcceleration?.id });

    const grouped = imported.pages[0].objects.filter((object) => object.groupId);
    expect(new Set(grouped.map((object) => object.groupId)).size).toBe(1);
    expect(grouped[0].groupId).not.toBe("group-original");

    const importedQuiz = imported.pages[0].objects.find((object) => object.kind === "quiz-card");
    expect(importedQuiz?.options.some((option) => option.id === importedQuiz.correctOptionId)).toBe(true);
    expect(importedQuiz?.correctOptionId).not.toBe("option-half");

    const importedTransaction = imported.pages[0].aiTransactions[0];
    expect(importedTransaction.transactionId).not.toBe("transaction-original");
    expect(importedTransaction.sources[0].id).toBe(importedForce?.id);
    expect(importedTransaction.sources[1].id).not.toBe("deleted-source");
    expect(importedTransaction.generatedObjectIds).toEqual([importedAcceleration?.id]);
  });

  it("round-trips converted handwriting together with its original ink", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    page.objects.push({
      id: "ink-text-original",
      revision: 2,
      kind: "ink-text",
      x: 40,
      y: 500,
      width: 90,
      height: 34,
      text: "velocity",
      fontSize: 28,
      color: "#183153",
      recognizedText: "velocty",
      recognizer: "trocr-small-handwritten-q8@2432e24d",
      sourceStrokes: [{ id: "stroke-source", revision: 1, kind: "stroke", tool: "pen", color: "#183153", size: 4, x: 38, y: 490, width: 96, height: 44, points: [{ x: 40, y: 500, pressure: 0.5, time: 0 }, { x: 130, y: 530, pressure: 0.6, time: 12 }] }],
    } satisfies InkTextObject);

    const imported = await readNotebookArchive(await createNotebookArchive([page], [], "2026-09-17T00:00:00.000Z"));
    const inkText = imported.pages[0].objects.find((object) => object.kind === "ink-text");
    expect(inkText).toMatchObject({ text: "velocity", recognizedText: "velocty", fontSize: 28, sourceStrokes: [{ points: [{ x: 40 }, { x: 130, pressure: 0.6 }] }] });
    expect(inkText?.id).not.toBe("ink-text-original");
  });

  it("rejects converted handwriting whose preserved ink is malformed", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    const inkText: InkTextObject = {
      id: "ink-text-original",
      revision: 2,
      kind: "ink-text",
      x: 40,
      y: 500,
      width: 90,
      height: 34,
      text: "velocity",
      fontSize: 28,
      color: "#183153",
      recognizedText: "velocty",
      recognizer: "trocr-small-handwritten-q8@2432e24d",
      sourceStrokes: [{ id: "stroke-source", revision: 1, kind: "stroke", tool: "pen", color: "#183153", size: 4, x: 38, y: 490, width: 96, height: 44, points: [{ x: 40, y: 500, pressure: 0.5, time: 0 }, { x: 130, y: 530, pressure: 0.6, time: 12 }] }],
    } satisfies InkTextObject;
    page.objects.push({ ...inkText, sourceStrokes: [{ ...inkText.sourceStrokes[0], points: [{ x: 1, y: Number.NaN, pressure: 0.5, time: 0 }] }] });
    await expect(createNotebookArchive([page], [])).rejects.toThrow(/invalid point/);
    page.objects[page.objects.length - 1] = { ...inkText, sourceStrokes: [] };
    await expect(createNotebookArchive([page], [])).rejects.toThrow(/invalid source ink/);
  });

  it("rejects a page whose bytes no longer match its manifest hash", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    const archive = await createNotebookArchive([page], [], "2026-09-15T00:00:00.000Z");
    const files = unzipSync(archive);
    files["pages/0000.json"] = strToU8(JSON.stringify({ ...page, title: "Tampered" }));

    await expect(readNotebookArchive(zipSync(files))).rejects.toThrow(/integrity validation/);
  });

  it("refuses to export a notebook with a missing referenced asset", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    page.objects.push({
      id: "missing-image",
      revision: 1,
      kind: "image",
      assetHash: "a".repeat(64),
      mimeType: "image/png",
      name: "missing.png",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });

    await expect(createNotebookArchive([page], [])).rejects.toThrow(/referenced asset/);
  });

  it("rejects unsupported fields instead of carrying unknown imported data forward", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    Object.assign(page, { unexpected: "must not be archived" });
    await expect(createNotebookArchive([page], [])).rejects.toThrow(/unsupported field unexpected/);
  });

  it("rejects corrupt input without producing imported records", async () => {
    await expect(readNotebookArchive(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/corrupt or unsupported/);
  });

  it("imports a version-1 archive and migrates it to an empty AI transaction history", async () => {
    const current = pageFromFixture(phaseZeroFixture, 100);
    const { aiTransactions: _transactions, ...withoutTransactions } = current;
    const legacyPage = { ...withoutTransactions, schemaVersion: 1 };
    const pageBytes = strToU8(JSON.stringify(legacyPage));
    const manifest = {
      format: "ai-notebook",
      archiveVersion: 1,
      documentSchemaVersion: 1,
      exportedAt: "2026-09-15T00:00:00.000Z",
      pages: [{ id: legacyPage.id, title: legacyPage.title, path: "pages/0000.json", sha256: await sha256(pageBytes) }],
      assets: [],
    };
    const archive = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "pages/0000.json": pageBytes });
    const imported = await readNotebookArchive(archive, { now: 1_000 });
    expect(imported.pages[0]).toMatchObject({ schemaVersion: 4, aiTransactions: [] });
    expect(imported).toMatchObject({ sources: [], chatMessages: [] });
  });
});

describe(".ainotebook library (sources and chat)", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const sourceA: ArchivedSource = {
    source: { id: "source-a", name: "mechanics.pdf", kind: "pdf", size: 900, contentHash: hashA, pageCount: 3, chunkCount: 2, characterCount: 32, enabled: true, addedAt: 5 },
    chunks: [
      { id: "source-a:0", sourceId: "source-a", ordinal: 0, page: 1, text: "Newton's second law." },
      { id: "source-a:1", sourceId: "source-a", ordinal: 1, page: 3, text: "F equals ma." },
    ],
  };
  const sourceB: ArchivedSource = {
    source: { id: "source-b", name: "notes.md", kind: "text", size: 20, contentHash: hashB, chunkCount: 1, characterCount: 11, enabled: false, addedAt: 6 },
    chunks: [{ id: "source-b:0", sourceId: "source-b", ordinal: 0, text: "Plain notes" }],
  };
  const chatMessages: ChatMessageRecord[] = [
    { id: "message-1", role: "user", content: "What is force?", createdAt: 10 },
    {
      id: "message-2",
      role: "assistant",
      content: "Force is mass times acceleration [1][2].",
      createdAt: 11,
      provider: "deepseek",
      model: "deepseek-flash",
      citations: [
        { id: "S1", origin: "mechanics.pdf", locator: "p. 3", text: "F equals ma.", sourceId: "source-a" },
        { id: "N1", origin: "Notebook page", locator: "Diagram", text: "Force", pageId: "phase-zero-physics", objectId: "node-force" },
        { id: "N2", origin: "Notebook page", locator: "Note", text: "Gone", pageId: "page-not-archived", objectId: "whatever" },
      ],
    },
  ];

  async function archiveWithLibrary() {
    const page = pageFromFixture(phaseZeroFixture, 100);
    const archive = await createNotebookArchive([page], [], "2026-09-29T00:00:00.000Z", { sources: [sourceA, sourceB], chatMessages });
    return { page, archive };
  }

  it("round-trips sources, passages and chat with fresh ids and remapped citations", async () => {
    const { page, archive } = await archiveWithLibrary();
    expect(Object.keys(unzipSync(archive)).sort()).toEqual(["attempts.json", "chat.json", "manifest.json", "pages/0000.json", "sources/0000.json", "sources/0001.json"]);

    let nextId = 0;
    const imported = await readNotebookArchive(archive, { now: 1_000, idFactory: () => `copy-${++nextId}` });
    const [importedA, importedB] = imported.sources;
    expect(importedA.source).toMatchObject({ name: "mechanics.pdf", contentHash: hashA, pageCount: 3, chunkCount: 2, enabled: true });
    expect(importedA.source.id).not.toBe("source-a");
    expect(importedA.chunks.map((chunk) => [chunk.id, chunk.sourceId, chunk.page, chunk.text])).toEqual([
      [`${importedA.source.id}:0`, importedA.source.id, 1, "Newton's second law."],
      [`${importedA.source.id}:1`, importedA.source.id, 3, "F equals ma."],
    ]);
    expect(importedB.source.enabled).toBe(false);
    expect(importedB.chunks[0]).not.toHaveProperty("page");

    expect(imported.chatMessages.map((message) => message.content)).toEqual(["What is force?", "Force is mass times acceleration [1][2]."]);
    expect(imported.chatMessages.map((message) => message.id)).not.toContain("message-1");
    const [sourceCitation, pageCitation, danglingCitation] = imported.chatMessages[1].citations!;
    expect(sourceCitation.sourceId).toBe(importedA.source.id);
    const importedPage = imported.pages[0];
    expect(pageCitation.pageId).toBe(importedPage.id);
    expect(pageCitation.pageId).not.toBe(page.id);
    // Objects keep their order on import, so the copy of node-force sits at the same index.
    const forceIndex = page.objects.findIndex((object) => object.id === "node-force");
    expect(pageCitation.objectId).toBe(importedPage.objects[forceIndex].id);
    // A page that was not exported keeps its quoted text but loses the link.
    expect(danglingCitation).toEqual({ id: "N2", origin: "Notebook page", locator: "Note", text: "Gone" });
  });

  it("does not store a second copy of a source already on this device", async () => {
    const { archive } = await archiveWithLibrary();
    const imported = await readNotebookArchive(archive, { existingSourceIdsByHash: new Map([[hashA, "source-local"]]) });
    expect(imported.sources.map((entry) => entry.source.name)).toEqual(["notes.md"]);
    expect(imported.chatMessages[1].citations![0].sourceId).toBe("source-local");
  });

  it("rejects a source whose bytes no longer match the manifest", async () => {
    const { archive } = await archiveWithLibrary();
    const files = unzipSync(archive);
    files["sources/0000.json"] = strToU8(JSON.stringify({ source: sourceA.source, chunks: [{ ordinal: 0, text: "Injected" }] }));
    await expect(readNotebookArchive(zipSync(files))).rejects.toThrow(/sources\/0000.json failed integrity validation/);
  });

  it("rejects a source whose passages do not match what it declares", async () => {
    await expect(createNotebookArchive([pageFromFixture(phaseZeroFixture, 100)], [], undefined, {
      sources: [{ ...sourceA, chunks: sourceA.chunks.slice(0, 1) }],
      chatMessages: [],
    })).rejects.toThrow(/does not contain the passages it declares/);
    await expect(createNotebookArchive([pageFromFixture(phaseZeroFixture, 100)], [], undefined, {
      sources: [{ ...sourceA, chunks: [sourceA.chunks[0], { ...sourceA.chunks[1], page: 9 }] }],
      chatMessages: [],
    })).rejects.toThrow(/page it does not have/);
  });

  it("rejects chat messages with unknown fields or duplicate ids", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    await expect(createNotebookArchive([page], [], undefined, {
      sources: [],
      chatMessages: [{ ...chatMessages[0], reasoning: "hidden" } as ChatMessageRecord],
    })).rejects.toThrow(/unsupported field reasoning/);
    await expect(createNotebookArchive([page], [], undefined, { sources: [], chatMessages: [chatMessages[0], chatMessages[0]] })).rejects.toThrow(/duplicate id/);
  });

  it("refuses unlisted entries, so a library file cannot be smuggled into an archive", async () => {
    const { archive } = await archiveWithLibrary();
    const files = unzipSync(archive);
    files["sources/0002.json"] = strToU8("{}");
    await expect(readNotebookArchive(zipSync(files))).rejects.toThrow(/unexpected archive entry/);
  });
});

describe(".ainotebook quiz attempts", () => {
  const attempt = (id: string, overrides: Partial<QuizAttemptRecord> = {}): QuizAttemptRecord => ({
    id, pageId: "phase-zero-physics", quizId: "quiz-force", quizRevision: 1, chosenOptionId: "option-double", correct: false, sequence: 1, answeredAt: 50, ...overrides,
  });

  it("round-trips attempts pointing at the imported quiz and its remapped options", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    const archive = await createNotebookArchive([page], [], undefined, {
      sources: [],
      chatMessages: [],
      quizAttempts: [
        attempt("a1"),
        attempt("a2", { chosenOptionId: "option-half", correct: true, sequence: 2, answeredAt: 60, assistance: "hint" }),
        // An answer to a quiz that was later deleted, with an option that no longer exists.
        attempt("a3", { quizId: "quiz-deleted", chosenOptionId: "option-gone", answeredAt: 70 }),
        attempt("a4", { quizId: "quiz-deleted", chosenOptionId: "option-gone", sequence: 2, answeredAt: 80 }),
        // Left behind by a page that is not being exported.
        attempt("orphan", { pageId: "page-deleted-elsewhere" }),
      ],
    });

    const imported = await readNotebookArchive(archive, { now: 1_000 });
    const quiz = imported.pages[0].objects.find((object) => object.kind === "quiz-card")!;
    if (quiz.kind !== "quiz-card") throw new Error("expected a quiz");
    const labelOf = (optionId: string) => quiz.options.find((option) => option.id === optionId)?.label;

    expect(imported.quizAttempts).toHaveLength(4);
    const [first, second, deletedFirst, deletedSecond] = imported.quizAttempts;
    expect(first).toMatchObject({ pageId: imported.pages[0].id, quizId: quiz.id, correct: false, sequence: 1 });
    expect(labelOf(first.chosenOptionId)).toBe("It doubles");
    expect(second).toMatchObject({ chosenOptionId: quiz.correctOptionId, assistance: "hint" });
    expect(first).not.toHaveProperty("assistance");
    expect(new Set(imported.quizAttempts.map((entry) => entry.id)).size).toBe(4);
    expect(imported.quizAttempts.map((entry) => entry.id)).not.toContain("a1");
    // The deleted quiz keeps one consistent stand-in identity across its answers.
    expect(deletedFirst.quizId).toBe(deletedSecond.quizId);
    expect(deletedFirst.chosenOptionId).toBe(deletedSecond.chosenOptionId);
    expect(imported.pages[0].objects.map((object) => object.id)).not.toContain(deletedFirst.quizId);
  });

  it("rejects an attempt that claims a page the archive does not contain", async () => {
    const page = pageFromFixture(phaseZeroFixture, 100);
    const files = unzipSync(await createNotebookArchive([page], [], undefined, { sources: [], chatMessages: [], quizAttempts: [attempt("a1")] }));
    const forged = strToU8(JSON.stringify([attempt("a1", { pageId: "someone-elses-page" })]));
    files["attempts.json"] = forged;
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.attempts.sha256 = await sha256(forged);
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    await expect(readNotebookArchive(zipSync(files))).rejects.toThrow(/page that is not in the archive/);
  });
});
