import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  /** The accessible name of the button, also shown as its tooltip. */
  label: string;
  icon: ReactNode;
  /** Visible text beside the icon, for menus whose icon alone would be unclear. */
  text?: string;
  /** Which edge of the button the menu lines up with. */
  align?: "start" | "end";
  /** Opens below (the default) or above the button. */
  side?: "below" | "above";
  className?: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
};

/**
 * A button that opens a small panel of actions. The panel closes on Escape, on
 * a press outside it, or when an action calls `close`; focus returns to the button.
 */
export function MenuButton({ label, icon, text, align = "start", side = "below", className, disabled, children }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>(".menu-panel button:not(:disabled), .menu-panel select, .menu-panel input")?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    rootRef.current?.addEventListener("keydown", closeOnEscape);
    const root = rootRef.current;
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      root?.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`menu-button${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        {text && <span className="icon-button__text">{text}</span>}
      </button>
      {open && (
        <div id={panelId} className="menu-panel" data-align={align} data-side={side} role="group" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
