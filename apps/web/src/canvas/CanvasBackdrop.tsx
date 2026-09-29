import { memo } from "react";
import { Shape } from "react-konva";
import type { Camera } from "./cameraMath";
import { backgroundMarks, CANVAS_BACKGROUND_COLORS, type CanvasBackground } from "./canvasBackground";

const DOT_RADIUS = 1.25;

/** Half-pixel offset so a one-pixel line covers one row of pixels instead of blurring across two. */
const crisp = (value: number) => Math.round(value) + 0.5;

/**
 * The canvas pattern, drawn in viewport pixels behind the page's paper sheet.
 * Only the visible marks are drawn, in one Konva node, so panning redraws a
 * screenful rather than an infinite grid. Dots and lines keep a constant
 * on-screen size; their spacing follows the zoom.
 */
export const CanvasBackdrop = memo(function CanvasBackdrop({ style, camera, width, height }: { style: CanvasBackground; camera: Camera; width: number; height: number }) {
  if (style === "plain") return null;
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context) => {
        const marks = backgroundMarks(style, camera, width, height);
        // The native context, as InkStrokes uses: Konva's wrapper does not forward style properties.
        const native = context._context;
        native.save();
        const strokeLines = (color: string, xs: number[], ys: number[]) => {
          if (xs.length === 0 && ys.length === 0) return;
          native.beginPath();
          for (const x of xs) {
            native.moveTo(crisp(x), 0);
            native.lineTo(crisp(x), height);
          }
          for (const y of ys) {
            native.moveTo(0, crisp(y));
            native.lineTo(width, crisp(y));
          }
          native.strokeStyle = color;
          native.stroke();
        };
        native.lineWidth = 1;
        if (marks.kind === "dots") {
          native.beginPath();
          for (const y of marks.ys) {
            for (const x of marks.xs) {
              native.moveTo(x + DOT_RADIUS, y);
              native.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
            }
          }
          native.fillStyle = CANVAS_BACKGROUND_COLORS.dot;
          native.fill();
        } else if (marks.kind === "lines") {
          strokeLines(CANVAS_BACKGROUND_COLORS.rule, [], marks.ys);
          if (marks.marginX !== undefined) strokeLines(CANVAS_BACKGROUND_COLORS.margin, [marks.marginX], []);
        } else if (marks.kind === "graph") {
          strokeLines(CANVAS_BACKGROUND_COLORS.graphMinor, marks.minorXs, marks.minorYs);
          strokeLines(CANVAS_BACKGROUND_COLORS.graphMajor, marks.majorXs, marks.majorYs);
        }
        native.restore();
      }}
    />
  );
});
