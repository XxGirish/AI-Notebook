import { useEffect, useId, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

// Built on the native <dialog> so it gets a focus trap, Escape-to-cancel and
// the top layer for free: it stays above the canvas even in fullscreen.
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Cancel", tone = "default", onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Destructive actions start on the safe choice.
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      data-tone={tone}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      // Browsers only fire the native "cancel" for trusted Escape presses and
      // may skip it on repeats, so handle the key directly as well.
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      {/* The dialog itself has no padding, so a press landing on it (rather
          than this panel) can only be on the backdrop. */}
      <div className="confirm-dialog__panel">
        <div className="confirm-dialog__body">
          <h2 id={titleId}>{title}</h2>
          <p id={messageId}>{message}</p>
        </div>
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="confirm-dialog__confirm" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
