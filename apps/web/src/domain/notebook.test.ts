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
});
