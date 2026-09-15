import { describe, expect, it } from "vitest";
import { phaseZeroFixture } from "../fixtures/phaseZeroFixture";
import { validateFixture } from "./notebook";

describe("Phase 0 semantic fixture", () => {
  it("has unique ids, valid bindings, and a valid quiz answer key", () => {
    expect(validateFixture(phaseZeroFixture)).toEqual([]);
  });

  it("contains every object family required by the first comparison", () => {
    const kinds = new Set(phaseZeroFixture.objects.map((object) => object.kind));
    expect(kinds).toEqual(
      new Set([
        "stroke",
        "text-card",
        "equation-card",
        "graph-node",
        "connector",
        "quiz-card",
      ]),
    );
  });

  it("rejects image objects without a content hash", () => {
    expect(validateFixture({
      schemaVersion: 1,
      id: "image-page",
      title: "Images",
      width: 800,
      height: 600,
      objects: [{
        id: "image-1",
        revision: 1,
        kind: "image",
        assetHash: "not-a-hash",
        mimeType: "image/png",
        name: "diagram.png",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }],
    })).toEqual(["Image image-1 has an invalid asset hash"]);
  });
});
