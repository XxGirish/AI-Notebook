import { useEffect, useRef, useState } from "react";
import type { NotebookPage } from "../domain/pages";
import type { WriterLeaseStatus } from "../persistence/writerLease";

type Props = {
  pages: NotebookPage[];
  activePageId: string;
  saveStatus: "loading" | "saving" | "saved" | "error";
  saveError?: string;
  storageSummary?: string;
  canRestore: boolean;
  transferStatus?: string;
  writerStatus: WriterLeaseStatus;
  onCreate: () => void;
  onOpen: (pageId: string) => void;
  onRename: (pageId: string, title: string) => void;
  onDelete: (pageId: string) => void;
  onRestore: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onTakeOver: () => void;
};

export function PageSidebar({ pages, activePageId, saveStatus, saveError, storageSummary, canRestore, transferStatus, writerStatus, onCreate, onOpen, onRename, onDelete, onRestore, onExport, onImport, onTakeOver }: Props) {
  const [renamingId, setRenamingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (writerStatus !== "writer") {
      setRenamingId(undefined);
      setDeletingId(undefined);
    }
  }, [writerStatus]);

  const beginRename = (page: NotebookPage) => {
    setDeletingId(undefined);
    setRenamingId(page.id);
    setDraftTitle(page.title);
  };

  const finishRename = () => {
    if (!renamingId) return;
    onRename(renamingId, draftTitle);
    setRenamingId(undefined);
  };

  return (
    <aside className="page-sidebar" aria-label="Notebook pages">
      <div className="page-sidebar__header">
        <div>
          <p className="page-sidebar__eyebrow">AI Notebook</p>
          <h2>Pages</h2>
        </div>
        <button type="button" className="new-page-button" onClick={onCreate} aria-label="Create new page" disabled={writerStatus !== "writer"}>+</button>
      </div>

      <nav className="page-list" aria-label="Page history">
        {pages.map((page) => (
          <div className="page-row" data-active={page.id === activePageId} data-confirming={deletingId === page.id} key={page.id}>
            {renamingId === page.id ? (
              <input
                ref={inputRef}
                className="page-title-input"
                value={draftTitle}
                maxLength={80}
                aria-label={`Rename ${page.title}`}
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={finishRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") finishRename();
                  if (event.key === "Escape") setRenamingId(undefined);
                }}
              />
            ) : (
              <button type="button" className="page-link" aria-current={page.id === activePageId ? "page" : undefined} onClick={() => { setDeletingId(undefined); onOpen(page.id); }}>
                <span className="page-icon" aria-hidden="true">▤</span>
                <span>{page.title}</span>
              </button>
            )}
            {renamingId !== page.id && (
              deletingId === page.id ? (
                <button
                  type="button"
                  className="confirm-delete-page-button"
                  onClick={() => { setDeletingId(undefined); onDelete(page.id); }}
                  aria-label={`Confirm delete ${page.title}`}
                  disabled={writerStatus !== "writer"}
                >Delete?</button>
              ) : (
                <>
                  <button type="button" className="rename-page-button" onClick={() => beginRename(page)} aria-label={`Rename ${page.title}`} title="Rename page" disabled={writerStatus !== "writer"}>✎</button>
                  <button type="button" className="delete-page-button" onClick={() => setDeletingId(page.id)} aria-label={`Delete ${page.title}`} title="Delete page" disabled={writerStatus !== "writer"}>×</button>
                </>
              )
            )}
          </div>
        ))}
      </nav>

      <div className="writer-state" data-state={writerStatus} role="status">
        <span>
          {writerStatus === "writer"
            ? "Editing in this tab"
            : writerStatus === "reader"
              ? "Read-only: another tab is editing"
              : writerStatus === "unsupported"
                ? "Read-only: tab locking unavailable"
                : "Checking edit access…"}
        </span>
        {writerStatus === "reader" && <button type="button" onClick={onTakeOver}>Take over editing</button>}
      </div>

      <div className="notebook-transfer" aria-label="Notebook transfer">
        <button type="button" onClick={onExport} disabled={saveStatus !== "saved"}>Export</button>
        <button type="button" onClick={() => archiveInputRef.current?.click()} disabled={saveStatus !== "saved" || writerStatus !== "writer"}>Import</button>
        <input
          ref={archiveInputRef}
          className="visually-hidden"
          type="file"
          accept=".ainotebook,application/vnd.ai-notebook+zip,application/zip"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onImport(file);
          }}
        />
        {transferStatus && <span role="status">{transferStatus}</span>}
      </div>

      <div className="page-sidebar__footer" data-status={saveStatus}>
        <div className="save-state">
          <span className="save-dot" aria-hidden="true" />
          <span>{saveStatus === "loading" ? "Opening notebook…" : saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved locally"}</span>
        </div>
        {saveError && <p className="save-error" role="alert">{saveError}</p>}
        {storageSummary && <span className="storage-summary">{storageSummary}</span>}
        {canRestore && <button type="button" className="restore-page-button" onClick={onRestore} disabled={writerStatus !== "writer"}>Restore previous</button>}
      </div>
    </aside>
  );
}
