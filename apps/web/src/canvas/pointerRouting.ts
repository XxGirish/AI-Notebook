export type Tool = "select" | "lasso" | "pen" | "pen-pro" | "highlighter" | "eraser" | "rectangle" | "ellipse" | "arrow" | "text" | "pan";
export type GestureKind = "stroke" | "erase" | "pan" | "lasso" | "shape" | "arrow" | "text";

// Tools that lay down ink. Pen Pro belongs here for every purpose except the
// name of the tool: it draws the same strokes and only neatens them afterwards,
// so anything keyed off "is the writer inking" has to include it.
export const INK_TOOLS = ["pen", "pen-pro", "highlighter"] as const;

export function isInkTool(tool: Tool) {
  return (INK_TOOLS as readonly string[]).includes(tool);
}

// Only the select tool leaves pointer gestures to the browser; everything else
// drives the camera or the canvas itself and must suppress native scrolling.
export function toolHandlesGestures(tool: Tool) {
  return tool !== "select";
}

/**
 * How bare touch contacts are treated on an inking tool.
 *
 * - `finger`  every contact draws. The only usable setting on a screen with no
 *             stylus at all, so it is the default.
 * - `palm`    contacts compete and the smallest one draws (see palmRejection).
 *             For a passive stylus, whose tip arrives as an ordinary touch.
 * - `stylus`  touch pans and only a real `pointerType: "pen"` draws. For an
 *             active stylus, where the hardware already separates the two.
 */
export type TouchMode = "finger" | "palm" | "stylus";

export type PointerRouting = {
  tool: Tool;
  pointerType: string;
  touchMode: TouchMode;
};

// Only `stylus` mode turns a finger into a pan. `palm` mode has to let touch
// through, because with a passive stylus the tip *is* a touch contact — which
// of them draws is decided per contact by palmRejection, not here.
export function touchShouldPan({ tool, pointerType, touchMode }: PointerRouting) {
  return pointerType === "touch" && touchMode === "stylus" && isInkTool(tool);
}

export function gestureKindFor(routing: PointerRouting): GestureKind {
  if (routing.tool === "pan" || touchShouldPan(routing)) return "pan";
  if (routing.tool === "eraser") return "erase";
  if (routing.tool === "lasso") return "lasso";
  if (routing.tool === "rectangle" || routing.tool === "ellipse") return "shape";
  if (routing.tool === "arrow") return "arrow";
  if (routing.tool === "text") return "text";
  return "stroke";
}

// An empty coalesced list means "no extra samples beyond this event", not "no
// input". Optional chaining alone only covers a browser without the method, so
// an empty list would silently drop the move and the stroke would go nowhere.
export function pointerSamples<T extends { getCoalescedEvents?: () => T[] }>(event: T): T[] {
  const coalesced = event.getCoalescedEvents?.();
  return coalesced && coalesced.length > 0 ? coalesced : [event];
}
