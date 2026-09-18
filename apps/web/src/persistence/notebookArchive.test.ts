import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ImageObject, InkTextObject } from "../domain/notebook";
import { pageFromFixture } from "../domain/pages";
import { phaseZeroFixture } from "../fixtures/phaseZeroFixture";
import type { AssetRecord } from "./notebookDatabase";
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
    const imported = await readNotebookArchive(archive, 1_000, () => `copy-${++nextId}`);

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
    const imported = await readNotebookArchive(archive, 1_000, () => crypto.randomUUID());
    expect(imported.pages[0]).toMatchObject({ schemaVersion: 4, aiTransactions: [] });
  });
});
