import { memo } from "react";
import { Rect, Shape } from "react-konva";
import { PAPER_COLORS, paperLines, type PaperStyle } from "../domain/paper";

/**
 * The page's optional sheet, drawn in world coordinates behind everything
 * else. The rules are one Konva node, like committed ink, so a lined page adds
 * one draw call rather than a node per line.
 */
export const PaperSheet = memo(function PaperSheet({ style, width, height }: { style: PaperStyle; width: number; height: number }) {
  const lines = paperLines(style, width, height);
  return (
    <>
      <Rect width={width} height={height} fill={PAPER_COLORS.sheet} stroke={PAPER_COLORS.edge} strokeWidth={1} shadowColor="rgba(48, 44, 35, 0.12)" shadowBlur={18} shadowOffsetY={4} perfectDrawEnabled={false} />
      {lines.length > 0 && (
        <Shape
          perfectDrawEnabled={false}
          sceneFunc={(context) => {
            // The native context, as InkStrokes uses: Konva's wrapper does not forward style properties.
            const native = context._context;
            native.save();
            native.lineWidth = 1;
            for (const kind of ["rule", "margin"] as const) {
              native.beginPath();
              for (const line of lines) {
                if (line.kind !== kind) continue;
                native.moveTo(line.x1, line.y1);
                native.lineTo(line.x2, line.y2);
              }
              native.strokeStyle = kind === "rule" ? PAPER_COLORS.rule : PAPER_COLORS.margin;
              native.stroke();
            }
            native.restore();
          }}
        />
      )}
    </>
  );
});
