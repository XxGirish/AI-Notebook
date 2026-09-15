import { useEffect, useRef, useState } from "react";
import type { NotebookPage } from "../domain/pages";

type Props = {
  pages: NotebookPage[];
  activePageId: string;
  saveStatus: "loading" | "saving" | "saved" | "error";
  canRestore: boolean;
  onCreate: () => void;
  onOpen: (pageId: string) => void;
  onRename: (pageId: string, title: string) => void;
  onDelete: (pageId: string) => void;
  onRestore: () => void;
};

export function PageSidebar({ pages, activePageId, saveStatus, canRestore, onCreate, onOpen, onRename, onDelete, onRestore }: Props) {
  const [renamingId, setRenamingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

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
        <button type="button" className="new-page-button" onClick={onCreate} aria-label="Create new page">+</button>
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
                >Delete?</button>
              ) : (
                <>
                  <button type="button" className="rename-page-button" onClick={() => beginRename(page)} aria-label={`Rename ${page.title}`} title="Rename page">✎</button>
                  <button type="button" className="delete-page-button" onClick={() => setDeletingId(page.id)} aria-label={`Delete ${page.title}`} title="Delete page">×</button>
                </>
              )
            )}
          </div>
        ))}
      </nav>

      <div className="page-sidebar__footer" data-status={saveStatus}>
        <div className="save-state">
          <span className="save-dot" aria-hidden="true" />
          <span>{saveStatus === "loading" ? "Opening notebook…" : saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : "Saved locally"}</span>
        </div>
        {canRestore && <button type="button" className="restore-page-button" onClick={onRestore}>Restore previous</button>}
      </div>
    </aside>
  );
}
