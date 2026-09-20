import { beforeAll, describe, expect, it } from "vitest";
import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import type { StrokeObject } from "../domain/notebook";
import { drawInk } from "./InkStrokes";

/**
 * The committed ink is one Konva node drawing every stroke, so what used to be
 * node properties — layer order, highlighter blending, the selection outline,
 * the offset of a stroke being dragged — is now this scene function's job.
 */
type Call = [string, ...unknown[]];

function fakeContext() {
  const calls: Call[] = [];
  let state: Record<string, unknown> = {};
  const stack: Array<Record<string, unknown>> = [];
  const native = {
    calls,
    save: () => { stack.push({ ...state }); calls.push(["save"]); },
    restore: () => {
      const restored = stack.pop();
      if (!restored) throw new Error("restore without a matching save");
      state = restored;
      calls.push(["restore"]);
    },
    translate: (x: number, y: number) => { calls.push(["translate", x, y]); },
    fill: (path: unknown) => calls.push(["fill", path, { ...state }]),
    stroke: (path: unknown) => calls.push(["stroke", path, { ...state }]),
    depth: () => stack.length,
  };
  for (const key of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "globalCompositeOperation"]) {
    Object.defineProperty(native, key, {
      get: () => state[key],
      set: (value) => { state[key] = value; calls.push([`set:${key}`, value]); },
    });
  }
  return { context: { _context: native } as unknown as Context, calls, depth: () => stack.length };
}

const shapeWith = (attrs: Record<string, unknown>) => (
  { getAttr: (key: string) => attrs[key] } as unknown as KonvaShape
);

const stroke = (id: string, tool: StrokeObject["tool"], x = 0): StrokeObject => ({
  id,
  revision: 1,
  kind: "stroke",
  tool,
  color: tool === "highlighter" ? "#f2c879" : "#183153",
  size: 4,
  x,
  y: 0,
  width: 20,
  height: 20,
  points: [
    { x, y: 0, pressure: 0.5, time: 0 },
    { x: x + 8, y: 6, pressure: 0.6, time: 8 },
    { x: x + 16, y: 2, pressure: 0.5, time: 16 },
  ],
});

const draw = (strokes: StrokeObject[], attrs: Record<string, unknown> = {}) => {
  const { context, calls, depth } = fakeContext();
  drawInk(context, shapeWith({
    strokes,
    selectedIds: new Set<string>(),
    transientPositions: {},
    cameraScale: 1,
    ...attrs,
  }));
  // Every save the scene function makes has to be undone, or the next node on
  // the layer inherits its blending.
  expect(depth()).toBe(0);
  return calls;
};

beforeAll(() => {
  // The outline cache builds real Path2D objects, which Node does not provide.
  if (typeof globalThis.Path2D === "undefined") {
    globalThis.Path2D = class {
      moveTo() {}
      quadraticCurveTo() {}
      closePath() {}
    } as unknown as typeof Path2D;
  }
});

describe("drawing every committed stroke from one node", () => {
  it("draws highlighters before pen ink so pen stays crisp on top", () => {
    const calls = draw([stroke("pen-1", "pen"), stroke("mark", "highlighter", 40), stroke("pen-2", "pen", 80)]);
    const fillColours = calls.filter(([name]) => name === "fill").map(([, , state]) => (state as Record<string, unknown>).fillStyle);
    expect(fillColours).toEqual(["#f2c879", "#183153", "#183153"]);
  });

  it("blends highlighters once and leaves pen ink unblended", () => {
    const calls = draw([stroke("mark-1", "highlighter"), stroke("mark-2", "highlighter", 30), stroke("pen", "pen", 60)]);

    expect(calls.filter(([name]) => name === "set:globalAlpha")).toEqual([["set:globalAlpha", 0.3]]);
    expect(calls.filter(([name]) => name === "set:globalCompositeOperation")).toEqual([["set:globalCompositeOperation", "multiply"]]);

    const penFill = calls.find(([name, , state]) => name === "fill" && (state as Record<string, unknown>).fillStyle === "#183153");
    const penState = penFill?.[2] as Record<string, unknown>;
    expect(penState.globalAlpha).toBeUndefined();
    expect(calls.filter(([name]) => name === "save")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "restore")).toHaveLength(1);
  });

  it("outlines only the selected strokes, at a width that survives zoom", () => {
    const calls = draw([stroke("a", "pen"), stroke("b", "pen", 40)], {
      selectedIds: new Set(["b"]),
      cameraScale: 0.5,
    });

    const outlines = calls.filter(([name]) => name === "stroke");
    expect(outlines).toHaveLength(1);
    expect((outlines[0][2] as Record<string, unknown>).strokeStyle).toBe("#ef8c45");
    expect((outlines[0][2] as Record<string, unknown>).lineWidth).toBe(4);
  });

  it("offsets a stroke being dragged and leaves the others where they are", () => {
    const dragged = stroke("moving", "pen", 100);
    const calls = draw([stroke("still", "pen"), dragged], {
      transientPositions: { moving: { x: 130, y: 45 } },
    });

    const translates = calls.filter(([name]) => name === "translate");
    expect(translates).toEqual([["translate", 30, 45]]);
    // The offset is undone before the next stroke is drawn.
    expect(calls.filter(([name]) => name === "save")).toHaveLength(1);
    expect(calls.filter(([name]) => name === "restore")).toHaveLength(1);
  });

  it("draws nothing when the page has no ink", () => {
    expect(draw([])).toEqual([]);
  });
});
