import { describe, expect, it } from "vitest";
import { gestureKindFor, isInkTool, pointerSamples, toolHandlesGestures, touchShouldPan, type Tool } from "./pointerRouting";

const ALL_TOOLS: Tool[] = ["select", "lasso", "pen", "pen-pro", "highlighter", "eraser", "rectangle", "ellipse", "text", "pan"];

describe("canvas pointer routing", () => {
  it("treats Pen Pro as an inking tool everywhere Pen is one", () => {
    expect(isInkTool("pen-pro")).toBe(isInkTool("pen"));
    expect(isInkTool("pen-pro")).toBe(true);
  });

  it("draws with a finger by default so a touch-only screen can write", () => {
    for (const tool of ["pen", "pen-pro", "highlighter"] as Tool[]) {
      expect(gestureKindFor({ tool, pointerType: "touch", touchMode: "finger" })).toBe("stroke");
    }
  });

  it("pans with a finger on inking tools in stylus-only mode", () => {
    for (const tool of ["pen", "pen-pro", "highlighter"] as Tool[]) {
      expect(gestureKindFor({ tool, pointerType: "touch", touchMode: "stylus" })).toBe("pan");
    }
  });

  it("lets touch through in palm mode, where the tip is itself a touch contact", () => {
    for (const tool of ["pen", "pen-pro", "highlighter"] as Tool[]) {
      expect(touchShouldPan({ tool, pointerType: "touch", touchMode: "palm" })).toBe(false);
      expect(gestureKindFor({ tool, pointerType: "touch", touchMode: "palm" })).toBe("stroke");
    }
  });

  it("never diverts a stylus or a mouse into a pan", () => {
    for (const pointerType of ["pen", "mouse"]) {
      expect(touchShouldPan({ tool: "pen-pro", pointerType, touchMode: "stylus" })).toBe(false);
      expect(gestureKindFor({ tool: "pen-pro", pointerType, touchMode: "stylus" })).toBe("stroke");
    }
  });

  it("leaves palm rejection out of the non-inking tools", () => {
    for (const tool of ["eraser", "lasso", "rectangle", "ellipse"] as Tool[]) {
      expect(touchShouldPan({ tool, pointerType: "touch", touchMode: "stylus" })).toBe(false);
    }
  });

  it("maps each tool to its gesture", () => {
    const routing = (tool: Tool) => gestureKindFor({ tool, pointerType: "mouse", touchMode: "finger" });
    expect(routing("pan")).toBe("pan");
    expect(routing("eraser")).toBe("erase");
    expect(routing("lasso")).toBe("lasso");
    expect(routing("rectangle")).toBe("shape");
    expect(routing("ellipse")).toBe("shape");
    expect(routing("text")).toBe("text");
    expect(routing("pen-pro")).toBe("stroke");
  });

  it("claims native touch gestures for every tool that drives the canvas itself", () => {
    for (const tool of ALL_TOOLS) {
      expect(toolHandlesGestures(tool)).toBe(tool !== "select");
    }
  });

  it("falls back to the event itself when no coalesced samples are reported", () => {
    type Sample = { id: string; getCoalescedEvents?: () => Sample[] };
    const withoutSupport: Sample = { id: "a" };
    const withEmptyList: Sample = { id: "b", getCoalescedEvents: () => [] };

    expect(pointerSamples(withoutSupport)).toEqual([withoutSupport]);
    expect(pointerSamples(withEmptyList)).toEqual([withEmptyList]);
  });

  it("uses the coalesced samples when the browser reports them", () => {
    type Sample = { id: string; getCoalescedEvents?: () => Sample[] };
    const a: Sample = { id: "a" };
    const b: Sample = { id: "b" };
    const event: Sample = { id: "latest", getCoalescedEvents: () => [a, b] };

    expect(pointerSamples(event)).toEqual([a, b]);
  });
});

describe("arrow tool", () => {
  it("routes every pointer type to an arrow gesture, except touch panning in stylus mode", () => {
    expect(gestureKindFor({ tool: "arrow", pointerType: "mouse", touchMode: "finger" })).toBe("arrow");
    expect(gestureKindFor({ tool: "arrow", pointerType: "touch", touchMode: "stylus" })).toBe("arrow");
    expect(gestureKindFor({ tool: "arrow", pointerType: "pen", touchMode: "palm" })).toBe("arrow");
  });
});
