import { useEffect, useRef, useState } from "react";
import { PanelLeftClose, Plus } from "lucide-react";
import { movePage, type NotebookPage } from "../domain/pages";
import type { WriterLeaseStatus } from "../persistence/writerLease";

type Props = {
  pages: NotebookPage[];
  activePageId: string;
  writerStatus: WriterLeaseStatus;
  onCreate: () => void;
  onOpen: (pageId: string) => void;
  onRename: (pageId: string, title: string) => void;
  onReorder: (pageId: string, toIndex: number) => void;
  onDelete: (pageId: string) => void;
  onClose: () => void;
};

export function PageSidebar({ pages, activePageId, writerStatus, onCreate, onOpen, onRename, onReorder, onDelete, onClose }: Props) {
  const [renamingId, setRenamingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  // While a page is dragged the list shows where it will land.
  const [dragging, setDragging] = useState<{ pageId: string; toIndex: number }>();
  // Pointer events can arrive faster than renders, so the drag itself lives in a ref.
  const dragRef = useRef<{ pageId: string; toIndex: number }>();
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const canEdit = writerStatus === "writer";
  const shownPages = dragging ? movePage(pages, dragging.pageId, dragging.toIndex) : pages;

  /** The index a dragged page would take if dropped at this height. */
  const dropIndexAt = (clientY: number, pageId: string) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".page-row") ?? [])].filter((row) => row.dataset.pageId !== pageId);
    const before = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return before === -1 ? rows.length : before;
  };

  const moveByKeyboard = (page: NotebookPage, index: number, delta: number) => {
    const toIndex = Math.max(0, Math.min(pages.length - 1, index + delta));
    if (toIndex === index) return;
    onReorder(page.id, toIndex);
    setMoveAnnouncement(`${page.title} moved to position ${toIndex + 1} of ${pages.length}`);
  };

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
    <aside className="page-sidebar" id="page-sidebar" aria-label="Notebook pages">
      <div className="page-sidebar__header">
        <h2>Pages</h2>
        <button type="button" className="new-page-button" onClick={onCreate} aria-label="Create new page" title="New page" disabled={writerStatus !== "writer"}>
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Hide pages" title="Hide pages (Ctrl+\)">
          <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <nav className="page-list" aria-label="Page history" ref={listRef}>
        {shownPages.map((page, index) => (
          <div className="page-row" data-page-id={page.id} data-active={page.id === activePageId} data-confirming={deletingId === page.id} data-dragging={dragging?.pageId === page.id} key={page.id}>
            <button
              type="button"
              className="page-drag-handle"
              aria-label={`Reorder ${page.title}, position ${index + 1} of ${pages.length}. Use the up and down arrow keys.`}
              title="Drag to reorder, or focus and use the arrow keys"
              disabled={!canEdit}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                moveByKeyboard(page, index, event.key === "ArrowUp" ? -1 : 1);
              }}
              onPointerDown={(event) => {
                if (!canEdit || event.button !== 0) return;
                event.preventDefault();
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // A pointer that already ended cannot be captured; the drag still runs.
                }
                dragRef.current = { pageId: page.id, toIndex: index };
                setDragging(dragRef.current);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (drag?.pageId !== page.id) return;
                const toIndex = dropIndexAt(event.clientY, page.id);
                if (toIndex === drag.toIndex) return;
                dragRef.current = { pageId: page.id, toIndex };
                setDragging(dragRef.current);
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current;
                dragRef.current = undefined;
                setDragging(undefined);
                if (drag?.pageId === page.id) onReorder(page.id, dropIndexAt(event.clientY, page.id));
              }}
              onPointerCancel={() => {
                dragRef.current = undefined;
                setDragging(undefined);
              }}
            >
              <span aria-hidden="true">⠿</span>
            </button>
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
      <p className="visually-hidden" role="status" aria-live="polite">{moveAnnouncement}</p>
    </aside>
  );
}
