import { describe, expect, it } from "vitest";
import { contactSize, inkingContactId, reportsContactGeometry, type Contact } from "./palmRejection";

const contact = (pointerId: number, size: number, startedAt = pointerId, pointerType = "touch"): Contact =>
  ({ pointerId, pointerType, size, startedAt });

describe("palm rejection", () => {
  it("reads the footprint from whichever axis is wider", () => {
    expect(contactSize({ width: 8, height: 42 })).toBe(42);
    expect(contactSize({ width: 12, height: 3 })).toBe(12);
    expect(contactSize({})).toBe(0);
    expect(contactSize({ width: Number.NaN, height: 9 })).toBe(9);
  });

  it("lets the stylus tip draw when the palm lands first", () => {
    // The real sequence with a passive stylus: hand down, then the tip.
    const palm = contact(1, 58, 100);
    const tip = contact(2, 11, 180);

    expect(inkingContactId([palm, tip])).toBe(tip.pointerId);
  });

  it("keeps the tip drawing as the palm spreads out mid-stroke", () => {
    expect(inkingContactId([contact(1, 96, 100), contact(2, 11, 180)])).toBe(2);
  });

  it("rejects a hand-sized contact even when it is the only other one", () => {
    expect(inkingContactId([contact(1, 40, 100), contact(2, 34, 200)])).toBe(2);
  });

  it("draws with a lone finger-sized contact", () => {
    expect(inkingContactId([contact(1, 12)])).toBe(1);
  });

  it("refuses a lone hand-sized contact, which is a palm resting between words", () => {
    expect(inkingContactId([contact(1, 70)])).toBeUndefined();
    expect(inkingContactId([contact(1, 58), contact(2, 61)])).toBeUndefined();
  });

  it("prefers a real stylus over any finger regardless of footprint", () => {
    const finger = contact(1, 4, 100);
    const pen = contact(2, 20, 200, "pen");

    expect(inkingContactId([finger, pen])).toBe(pen.pointerId);
  });

  it("holds the current stroke when two contacts are the same size", () => {
    // Two fingers, nothing to choose between them: the earlier one is already
    // drawing, so switching would only break the stroke in half.
    expect(inkingContactId([contact(1, 14, 100), contact(2, 14, 200)])).toBe(1);
  });

  it("holds the current stroke when the screen reports no geometry", () => {
    expect(inkingContactId([contact(1, 1, 100), contact(2, 1, 200)])).toBe(1);
  });

  it("does not switch on a footprint difference too small to be a palm", () => {
    // 1.4x apart: within the spread of one finger pressed harder.
    expect(inkingContactId([contact(1, 20, 100), contact(2, 14, 200)])).toBe(1);
  });

  it("reports whether the screen measures footprints at all", () => {
    expect(reportsContactGeometry([contact(1, 1), contact(2, 1)])).toBe(false);
    expect(reportsContactGeometry([])).toBe(false);
    expect(reportsContactGeometry([contact(1, 1), contact(2, 46)])).toBe(true);
  });

  it("returns nothing when the glass is clear", () => {
    expect(inkingContactId([])).toBeUndefined();
  });
});
