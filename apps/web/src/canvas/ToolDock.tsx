import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Circle, Eraser, Hand, Highlighter, ImagePlus, Lasso, MousePointer2, MoveUpRight, PenLine, Plus, Sparkles, Square, StickyNote, Type } from "lucide-react";
import type { AiIntent } from "@ai-notebook/ai-contract";
import { MenuButton } from "../components/MenuButton";
import type { TouchMode, Tool } from "./pointerRouting";

type ShapeTool = "rectangle" | "ellipse" | "arrow";
type PenTool = "pen" | "pen-pro";
const SHAPE_TOOLS: ShapeTool[] = ["rectangle", "ellipse", "arrow"];
const isShapeTool = (tool: Tool): tool is ShapeTool => (SHAPE_TOOLS as string[]).includes(tool);
const isPenTool = (tool: Tool): tool is PenTool => tool === "pen" || tool === "pen-pro";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;
const SHAPES: Record<ShapeTool, { label: string; key: string; icon: ReactNode }> = {
  rectangle: { label: "Rectangle", key: "R", icon: <Square {...ICON} /> },
  ellipse: { label: "Ellipse", key: "O", icon: <Circle {...ICON} /> },
  arrow: { label: "Arrow", key: "A", icon: <MoveUpRight {...ICON} /> },
};

export type AiMenuAction = { intent: AiIntent; label: string; requiresContext: boolean };

type Props = {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  readOnly: boolean;
  penSize: number;
  highlighterSize: number;
  onStrokeSizeChange: (size: number) => void;
  touchMode: TouchMode;
  onTouchModeChange: (mode: TouchMode) => void;
  /** Shown while the text tool is active or a text box is selected. */
  textSize?: { value: number; options: ReadonlyArray<{ label: string; value: number }>; editingSelection: boolean; onChange: (size: number) => void };
  onInsertNote: () => void;
  onInsertImage: () => void;
  aiActions: AiMenuAction[];
  aiBusy: boolean;
  hasSelection: boolean;
  onRunAi: (intent: AiIntent) => void;
  /** A fixture lesson built on this device, offered only in development builds. */
  onMockLesson?: () => void;
};

/**
 * The floating toolbar at the top centre of the canvas, with a second strip
 * underneath for the options of the active tool. Top rather than bottom so a
 * writing hand resting on a tablet does not land on it.
 */
export function ToolDock({
  tool, onToolChange, readOnly, penSize, highlighterSize, onStrokeSizeChange, touchMode, onTouchModeChange, textSize,
  onInsertNote, onInsertImage, aiActions, aiBusy, hasSelection, onRunAi, onMockLesson,
}: Props) {
  // The pen and shape buttons come back to the variant used last.
  const [lastPen, setLastPen] = useState<PenTool>("pen");
  const [lastShape, setLastShape] = useState<ShapeTool>("rectangle");
  useEffect(() => {
    if (isPenTool(tool)) setLastPen(tool);
    if (isShapeTool(tool)) setLastShape(tool);
  }, [tool]);

  const toolButton = (value: Tool, label: string, shortcut: string, icon: ReactNode, pressed = tool === value) => (
    <button
      key={value}
      type="button"
      className="icon-button"
      aria-pressed={pressed}
      aria-label={label}
      aria-keyshortcuts={shortcut === "Space" ? "Space" : shortcut}
      title={`${label} (${shortcut})`}
      disabled={readOnly && value !== "select" && value !== "pan"}
      onClick={() => onToolChange(value)}
    >
      {icon}
    </button>
  );

  // Arrow keys move along the toolbar, as in any toolbar widget.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled), :scope > .menu-button > button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  const strokeSize = tool === "highlighter" ? highlighterSize : penSize;
  const touchControl = (
    <label className="tool-option">
      <span>Touch</span>
      <select value={touchMode} onChange={(event) => onTouchModeChange(event.target.value as TouchMode)} disabled={readOnly} title="How bare touch contacts are treated while inking">
        <option value="finger">Finger draws</option>
        <option value="palm">Palm rejection</option>
        <option value="stylus">Stylus only</option>
      </select>
    </label>
  );

  let options: ReactNode = null;
  if (isPenTool(tool) || tool === "highlighter") {
    options = (
      <>
        <label className="tool-option">
          <span>Size</span>
          <input
            type="range"
            min={tool === "highlighter" ? 10 : 1.5}
            max={tool === "highlighter" ? 40 : 14}
            step={0.5}
            value={strokeSize}
            onChange={(event) => onStrokeSizeChange(Number(event.target.value))}
          />
          <output>{strokeSize}px</output>
        </label>
        {isPenTool(tool) && (
          <label className="tool-option" title="Pause after writing and the pen neatens your handwriting into text (W)">
            <input type="checkbox" checked={tool === "pen-pro"} onChange={(event) => onToolChange(event.target.checked ? "pen-pro" : "pen")} disabled={readOnly} />
            <span>Neaten handwriting</span>
          </label>
        )}
        {touchControl}
      </>
    );
  } else if (isShapeTool(tool)) {
    options = (
      <div className="tool-option" role="group" aria-label="Shape">
        {SHAPE_TOOLS.map((shape) => toolButton(shape, SHAPES[shape].label, SHAPES[shape].key, SHAPES[shape].icon))}
      </div>
    );
  } else if (tool === "eraser") {
    options = <span className="tool-option tool-option--hint">Erases whole strokes</span>;
  } else if (textSize) {
    options = (
      <>
        <label className="tool-option">
          <span>Text size</span>
          <select value={textSize.value} onChange={(event) => textSize.onChange(Number(event.target.value))} disabled={readOnly} title={textSize.editingSelection ? "Size of the selected text" : "Size for new text"}>
            {textSize.options.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
            {!textSize.options.some(({ value }) => value === textSize.value) && <option value={textSize.value}>{textSize.value}px</option>}
          </select>
        </label>
        {tool === "text" && <span className="tool-option tool-option--hint">Click to type, or drag to size a box</span>}
      </>
    );
  }

  return (
    <div className="tool-dock-stack">
      <div className="tool-dock canvas-chrome" role="toolbar" aria-label="Canvas tools" onKeyDown={moveFocus}>
        {toolButton("select", "Select", "V", <MousePointer2 {...ICON} />)}
        {toolButton("lasso", "Lasso", "L", <Lasso {...ICON} />)}
        {toolButton(lastPen, lastPen === "pen-pro" ? "Pen, neatening" : "Pen", lastPen === "pen-pro" ? "W" : "P", <PenLine {...ICON} />, isPenTool(tool))}
        {toolButton("highlighter", "Highlighter", "H", <Highlighter {...ICON} />)}
        {toolButton("eraser", "Eraser", "E", <Eraser {...ICON} />)}
        {toolButton(lastShape, `Shapes: ${SHAPES[lastShape].label}`, SHAPES[lastShape].key, SHAPES[lastShape].icon, isShapeTool(tool))}
        {toolButton("text", "Text", "T", <Type {...ICON} />)}
        {toolButton("pan", "Hand", "Space", <Hand {...ICON} />)}
        <span className="tool-dock__divider" aria-hidden="true" />
        <MenuButton label="Insert" icon={<Plus {...ICON} />} disabled={readOnly}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { close(); onInsertNote(); }}><StickyNote size={18} aria-hidden="true" /> Note</button>
              <button type="button" className="menu-item" onClick={() => { close(); onInsertImage(); }}><ImagePlus size={18} aria-hidden="true" /> Image…</button>
            </>
          )}
        </MenuButton>
        <MenuButton label="AI actions" icon={<Sparkles {...ICON} />} align="end" disabled={readOnly}>
          {(close) => (
            <>
              {aiActions.map(({ intent, label, requiresContext }) => (
                <button
                  key={intent}
                  type="button"
                  className="menu-item"
                  disabled={aiBusy || (requiresContext && !hasSelection)}
                  onClick={() => { close(); onRunAi(intent); }}
                >
                  <span>{label}</span>
                  {requiresContext && !hasSelection && <span className="menu-item__hint">Select something first</span>}
                </button>
              ))}
              {onMockLesson && (
                <button type="button" className="menu-item" disabled={aiBusy} onClick={() => { close(); onMockLesson(); }} title="Build a fixture lesson on this device, with no network request">
                  <span>Mock lesson</span>
                  <span className="menu-item__hint">Development only</span>
                </button>
              )}
            </>
          )}
        </MenuButton>
      </div>
      {options && <div className="tool-options canvas-chrome" aria-label="Tool options" role="group">{options}</div>}
    </div>
  );
}
