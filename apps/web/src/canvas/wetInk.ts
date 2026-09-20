import type { PointSample, StrokeObject } from "../domain/notebook";
import type { Camera } from "./cameraMath";
import { getStrokeOutline } from "./strokePath";

/**
 * "Wet" ink: the stroke still under the pen, drawn on its own canvas straight
 * from the pointer handler.
 *
 * Routing each move through React state and the Konva scene cost a full
 * component render per event (60 ms median on an 800-stroke page) plus a
 * redraw of every committed stroke per frame, so the ink visibly trailed the
 * pen and fell further behind as a page filled up. Here a move redraws only
 * the one live stroke, synchronously, so it reaches the very next frame.
 *
 * Wet ink never becomes document data. A finished stroke is committed as usual
 * and stays on this canvas only until the Konva layer has drawn it ("settling"),
 * so there is no frame where the stroke is on neither surface.
 */

export type WetStrokeStyle = {
  tool: StrokeObject["tool"];
  color: string;
  size: number;
  opacity: number;
};

type InkPoint = Pick<PointSample, "x" | "y" | "pressure">;

type Settling = { path: Path2D; style: WetStrokeStyle; since: number };

/** A settling stroke the document never picked up (e.g. a refused commit) is dropped after this. */
const SETTLE_TIMEOUT_MS = 1_000;

export function outlineToPath2D(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 3) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    const point = outline[index];
    const next = outline[(index + 1) % outline.length];
    path.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
  }
  path.closePath();
  return path;
}

export class WetInkLayer {
  private readonly context: CanvasRenderingContext2D | null;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private pixelRatio = 1;
  private live?: { style: WetStrokeStyle; path: Path2D };
  private readonly settling = new Map<string, Settling>();
  private settleFrame?: number;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d");
  }

  resize(width: number, height: number, pixelRatio: number) {
    this.pixelRatio = pixelRatio;
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.draw();
  }

  setCamera(camera: Camera) {
    this.camera = camera;
    this.draw();
  }

  /** Redraws the live stroke from its samples. `predicted` points are display-only. */
  update(style: WetStrokeStyle, points: InkPoint[], predicted: InkPoint[] = []) {
    const outline = getStrokeOutline(predicted.length > 0 ? [...points, ...predicted] : points, style.size, style.tool);
    this.live = { style, path: outlineToPath2D(outline) };
    this.canvas.style.mixBlendMode = style.tool === "highlighter" ? "multiply" : "";
    this.draw();
  }

  /** Drops the live stroke without keeping it (cancelled, or rejected as a palm). */
  discard() {
    this.live = undefined;
    this.draw();
  }

  /**
   * Keeps the finished stroke visible under `id` until the committed copy is
   * drawn. Its final shape comes from the samples alone, without predictions.
   */
  settle(id: string, style: WetStrokeStyle, points: InkPoint[]) {
    this.live = undefined;
    this.settling.set(id, { path: outlineToPath2D(getStrokeOutline(points, style.size, style.tool)), style, since: performance.now() });
    this.draw();
  }

  /**
   * Called after a document render. Konva draws the new strokes in its next
   * animation frame, requested during that render; this frame is requested
   * after it, so the wet copies disappear in the same frame the dry ones appear.
   */
  release(isCommitted: (id: string) => boolean) {
    if (this.settling.size === 0 || this.settleFrame !== undefined) return;
    this.settleFrame = requestAnimationFrame(() => {
      this.settleFrame = undefined;
      const now = performance.now();
      let changed = false;
      for (const [id, entry] of this.settling) {
        if (isCommitted(id) || now - entry.since > SETTLE_TIMEOUT_MS) {
          this.settling.delete(id);
          changed = true;
        }
      }
      if (changed) this.draw();
      if (this.settling.size > 0) this.release(isCommitted);
    });
  }

  dispose() {
    if (this.settleFrame !== undefined) cancelAnimationFrame(this.settleFrame);
    this.settleFrame = undefined;
    this.settling.clear();
    this.live = undefined;
  }

  private draw() {
    const context = this.context;
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.live && this.settling.size === 0) return;
    const ratio = this.pixelRatio;
    context.setTransform(ratio * this.camera.scale, 0, 0, ratio * this.camera.scale, ratio * this.camera.x, ratio * this.camera.y);
    for (const entry of this.settling.values()) this.fill(context, entry.path, entry.style);
    if (this.live) this.fill(context, this.live.path, this.live.style);
  }

  private fill(context: CanvasRenderingContext2D, path: Path2D, style: WetStrokeStyle) {
    context.globalAlpha = style.opacity;
    context.fillStyle = style.color;
    context.fill(path);
    context.globalAlpha = 1;
  }
}

type InkTrailStyle = { color: string; diameter: number };
type DelegatedInkTrailPresenter = {
  updateInkTrailStartPoint(event: PointerEvent, style: InkTrailStyle): void | Promise<void>;
};
type NavigatorWithInk = Navigator & {
  ink?: { requestPresenter(options: { presentationArea: Element }): Promise<DelegatedInkTrailPresenter> };
};

/**
 * Delegated ink trail (Ink API, Chromium on Windows): after each frame the app
 * says which pointer event it last drew, and the OS compositor draws the ink
 * from there to where the pen is now, without waiting for the page. It hides
 * the remaining frame of latency. Unsupported browsers simply never get a
 * presenter, and any failure turns the feature off for the session.
 */
export class InkTrail {
  private presenter?: DelegatedInkTrailPresenter;
  private requested = false;

  constructor(private readonly area: () => Element | null) {}

  get active() {
    return this.presenter !== undefined;
  }

  prepare() {
    if (this.requested) return;
    this.requested = true;
    const ink = (navigator as NavigatorWithInk).ink;
    const area = this.area();
    if (!ink?.requestPresenter || !area) return;
    ink.requestPresenter({ presentationArea: area }).then(
      (presenter) => { this.presenter = presenter; },
      () => { this.presenter = undefined; },
    );
  }

  /** `event` must be the trusted event whose position was drawn last. */
  update(event: PointerEvent, style: InkTrailStyle) {
    const presenter = this.presenter;
    if (!presenter || !event.isTrusted) return;
    try {
      const pending = presenter.updateInkTrailStartPoint(event, style);
      if (pending instanceof Promise) pending.catch(() => { this.presenter = undefined; });
    } catch {
      this.presenter = undefined;
    }
  }
}

/**
 * Predicted pointer positions extend the drawn tip toward where the pen will
 * be by the time the frame is shown. They are capped so a wrong guess at a
 * sharp turn in small writing cannot draw a visible whisker, and they are
 * discarded on the next event.
 */
export function limitPrediction<T extends { x: number; y: number }>(from: T, predicted: T[], maximumDistance: number): T[] {
  const result: T[] = [];
  let travelled = 0;
  let previous = from;
  for (const point of predicted) {
    const step = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (travelled + step > maximumDistance) break;
    travelled += step;
    result.push(point);
    previous = point;
  }
  return result;
}
