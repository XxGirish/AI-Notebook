import { useEffect, useId, useRef, useState } from "react";
import { AI_FEEDBACK_REASONS, MAX_FEEDBACK_NOTE, type AiFeedbackReason, type AiFeedbackRecord } from "../domain/aiFeedback";
import type { AiTransactionRecord } from "../domain/notebook";

type Props = {
  transaction: AiTransactionRecord;
  actionLabel: string;
  /** Selected sources still on the page; empty when they were deleted or never recorded. */
  sourceCount: number;
  reports: readonly AiFeedbackRecord[];
  readOnly: boolean;
  onShowSources: () => void;
  onReport: (reason: AiFeedbackReason, note: string) => Promise<void>;
  onClose: () => void;
};

const formatDate = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Where a piece of AI content came from, and a way to say it is wrong. Built on
 * the native <dialog> like ConfirmDialog, so it sits above the canvas (also in
 * fullscreen) with a focus trap and Escape to close.
 */
export function AiProvenanceDialog({ transaction, actionLabel, sourceCount, reports, readOnly, onShowSources, onReport, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState<AiFeedbackReason>("incorrect");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = async () => {
    setStatus("saving");
    try {
      await onReport(reason, note);
      setNote("");
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog ai-provenance"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="confirm-dialog__panel">
        <div className="confirm-dialog__body">
          <h2 id={titleId}>Made with AI · {actionLabel}</h2>
          <dl className="ai-provenance__facts">
            <dt>Model</dt><dd>{transaction.model} ({transaction.provider})</dd>
            <dt>Added</dt><dd>{formatDate(transaction.committedAt)}</dd>
            <dt>Based on</dt>
            <dd>
              {sourceCount > 0 ? (
                <button type="button" className="ai-provenance__link" onClick={onShowSources}>
                  Show the {sourceCount === 1 ? "note" : `${sourceCount} items`} it was based on
                </button>
              ) : transaction.sources.length > 0 ? "Notes that are no longer on this page" : "No selected notes"}
            </dd>
          </dl>
          <p>AI content can be wrong. Edit the card to correct it; your edit replaces the text on the page.</p>
        </div>

        {reports.length > 0 && (
          <div className="ai-provenance__reports">
            <h3>Your reports</h3>
            <ul>
              {reports.map((report) => (
                <li key={report.id}>{AI_FEEDBACK_REASONS[report.reason]}{report.note ? ` — ${report.note}` : ""} <span>({formatDate(report.createdAt)})</span></li>
              ))}
            </ul>
          </div>
        )}

        {!readOnly && (
          <form
            className="ai-provenance__report"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset>
              <legend>Report a problem</legend>
              {(Object.keys(AI_FEEDBACK_REASONS) as AiFeedbackReason[]).map((key) => (
                <label key={key}>
                  <input type="radio" name="ai-feedback-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
                  {AI_FEEDBACK_REASONS[key]}
                </label>
              ))}
            </fieldset>
            <label className="ai-provenance__note">
              What is wrong? (optional)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={MAX_FEEDBACK_NOTE} rows={3} />
            </label>
            <p className="ai-provenance__privacy">Reports stay in this browser with a copy of the card as it is now. Nothing is sent anywhere.</p>
            {status === "saved" && <p role="status">Report saved.</p>}
            {status === "failed" && <p role="alert">The report could not be saved to this browser's storage.</p>}
            <div className="confirm-dialog__actions">
              <button type="button" onClick={onClose}>Close</button>
              <button type="submit" className="confirm-dialog__confirm" disabled={status === "saving"}>Save report</button>
            </div>
          </form>
        )}
        {readOnly && (
          <div className="confirm-dialog__actions">
            <button type="button" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </dialog>
  );
}
