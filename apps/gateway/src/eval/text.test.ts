import { describe, expect, it } from "vitest";
import { containment, maxPairwiseSimilarity, maxSentenceEcho, sentences, shingles, similarity, words } from "./text";

describe("words", () => {
  it("drops punctuation and LaTeX control sequences", () => {
    expect(words("pH = pK_a + \\log_{10}\\frac{[A^-]}{[HA]}")).toEqual(["ph", "pk", "a", "10", "a", "ha"]);
  });

  it("returns nothing for empty input", () => {
    expect(words("   ...   ")).toEqual([]);
  });
});

describe("shingles", () => {
  it("produces overlapping n-grams", () => {
    expect([...shingles("one two three four", 2)]).toEqual(["one two", "two three", "three four"]);
  });

  it("returns the whole phrase when it is shorter than the window", () => {
    expect([...shingles("one two", 5)]).toEqual(["one two"]);
  });
});

describe("containment", () => {
  const page = "Braking distance grows with the square of speed because the kinetic energy that has to be removed goes as v squared.";

  it("scores a copied sentence near one", () => {
    expect(containment("Braking distance grows with the square of speed", page)).toBe(1);
  });

  it("scores unrelated new material near zero", () => {
    expect(containment("A wet road halves the available friction, so the same speed needs twice the room.", page)).toBe(0);
  });

  it("is not diluted by the length of the source", () => {
    const longPage = `${page} ${"Unrelated filler sentence about something else entirely. ".repeat(50)}`;
    expect(containment("Braking distance grows with the square of speed", longPage)).toBe(1);
  });

  it("scores empty candidates as zero rather than dividing by zero", () => {
    expect(containment("", page)).toBe(0);
  });
});

describe("similarity", () => {
  it("scores identical text as one", () => {
    expect(similarity("the cat sat down", "the cat sat down")).toBe(1);
  });

  it("scores a paraphrase between the extremes", () => {
    const score = similarity("the determinant scales area by that factor", "the determinant is the factor that scales area");
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(1);
  });

  it("scores unrelated text as zero", () => {
    expect(similarity("photosynthesis happens in chloroplasts", "the estates general met in 1789")).toBe(0);
  });
});

describe("sentences", () => {
  it("splits on terminators and newlines and drops fragments", () => {
    expect(sentences("A long enough first sentence here. Too short.\nAnother long enough sentence follows here.")).toEqual([
      "A long enough first sentence here.",
      "Another long enough sentence follows here.",
    ]);
  });
});

describe("maxSentenceEcho", () => {
  it("finds a restated sentence inside otherwise new text", () => {
    const page = "One pH unit is a factor of ten in concentration. A buffer resists change.";
    const generated = "Buffers appear throughout physiology. One pH unit is a factor of ten in concentration.";
    expect(maxSentenceEcho(generated, page)).toBe(1);
  });

  it("is zero when nothing is echoed", () => {
    expect(maxSentenceEcho("Entirely different material about music theory here.", "One pH unit is a factor of ten.")).toBe(0);
  });
});

describe("maxPairwiseSimilarity", () => {
  it("catches one answer saying the same thing twice", () => {
    expect(maxPairwiseSimilarity(["the raised seventh pulls to the tonic", "the raised seventh pulls to the tonic"])).toBe(1);
  });

  it("is zero for a single block", () => {
    expect(maxPairwiseSimilarity(["only one block here"])).toBe(0);
  });
});
