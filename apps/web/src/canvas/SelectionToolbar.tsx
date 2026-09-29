import type { ReactNode } from "react";
import { Copy, Group, Pencil, Sparkles, Spline, Trash2, Ungroup } from "lucide-react";

type Action = { label: string; icon: ReactNode; onClick: () => void; show: boolean; danger?: boolean };

type Props = {
  /** The selection's bounding box in screen pixels, relative to the canvas. */
  box: { left: number; top: number; width: number; height: number };
  viewport: { width: number; height: number };
  count: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onConnect?: () => void;
  onEditLabel?: () => void;
  onEditText?: () => void;
  onExplain?: () => void;
};

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;
const BAR_HEIGHT = 44;
const GAP = 10;
// Keeps the bar clear of the tool dock and its options strip.
const TOP_CLEARANCE = 112;

/** Actions for the current selection, floating just above it (or below, when there is no room). */
export function SelectionToolbar({ box, viewport, count, onDuplicate, onDelete, onGroup, onUngroup, onConnect, onEditLabel, onEditText, onExplain }: Props) {
  const actions: Action[] = [
    { label: "Edit text", icon: <Pencil {...ICON} />, onClick: () => onEditText?.(), show: Boolean(onEditText) },
    { label: "Edit label", icon: <Pencil {...ICON} />, onClick: () => onEditLabel?.(), show: Boolean(onEditLabel) && !onEditText },
    { label: "Duplicate", icon: <Copy {...ICON} />, onClick: onDuplicate, show: true },
    { label: "Group", icon: <Group {...ICON} />, onClick: () => onGroup?.(), show: Boolean(onGroup) },
    { label: "Ungroup", icon: <Ungroup {...ICON} />, onClick: () => onUngroup?.(), show: Boolean(onUngroup) },
    { label: "Connect the two selected objects", icon: <Spline {...ICON} />, onClick: () => onConnect?.(), show: Boolean(onConnect) },
    { label: "Explain selection with AI", icon: <Sparkles {...ICON} />, onClick: () => onExplain?.(), show: Boolean(onExplain) },
    { label: "Delete", icon: <Trash2 {...ICON} />, onClick: onDelete, show: true, danger: true },
  ];

  const above = box.top - GAP - BAR_HEIGHT;
  const top = above >= TOP_CLEARANCE ? above : Math.min(box.top + box.height + GAP, viewport.height - BAR_HEIGHT - 64);
  const centre = Math.max(160, Math.min(viewport.width - 160, box.left + box.width / 2));

  return (
    <div
      className="selection-toolbar canvas-chrome"
      role="toolbar"
      aria-label={`${count} selected`}
      style={{ top: Math.max(TOP_CLEARANCE, top), left: centre }}
    >
      {actions.filter((action) => action.show).map((action) => (
        <button key={action.label} type="button" className="icon-button" data-danger={action.danger || undefined} aria-label={action.label} title={action.label} onClick={action.onClick}>
          {action.icon}
        </button>
      ))}
    </div>
  );
}
