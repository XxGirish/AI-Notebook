import { describe, expect, it } from "vitest";
import { createNotebookPage } from "../domain/pages";
import { createRecoverySnapshot } from "./pageRecords";
import { orphanAssetHashes } from "./assetCleanup";

const image = (id: string, assetHash: string) => ({
  id,
  revision: 1,
  kind: "image" as const,
  assetHash,
  mimeType: "image/png",
  name: `${id}.png`,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

describe("asset cleanup", () => {
  it("keeps assets referenced by either current pages or recovery snapshots", () => {
    const current = createNotebookPage("Current", 10);
    current.objects = [image("current-image", "a".repeat(64))];
    const previous = createNotebookPage("Previous", 5);
    previous.objects = [image("recovery-image", "b".repeat(64))];

    expect(orphanAssetHashes(
      [current],
      [createRecoverySnapshot(previous)],
      ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
    )).toEqual(["c".repeat(64)]);
  });

  it("reclaims every stored asset when the notebook and recovery set are empty", () => {
    expect(orphanAssetHashes([], [], ["a".repeat(64), "b".repeat(64)])).toEqual(["a".repeat(64), "b".repeat(64)]);
  });
});
