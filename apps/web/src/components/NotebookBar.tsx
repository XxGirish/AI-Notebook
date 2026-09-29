import { useEffect, useRef, useState } from "react";
import { Archive, Download, Ellipsis, FileImage, PanelLeft, Printer, RotateCcw, TriangleAlert, Upload, WifiOff, X } from "lucide-react";
import type { WriterLeaseStatus } from "../persistence/writerLease";
import { MenuButton } from "./MenuButton";

type Props = {
  title?: string;
  activePageId: string;
  pagesOpen: boolean;
  onTogglePages: () => void;
  onRename: (title: string) => void;
  saveStatus: "loading" | "saving" | "saved" | "error";
  saveError?: string;
  storageSummary?: string;
  canRestore: boolean;
  transferStatus?: string;
  onDismissTransferStatus: () => void;
  isOnline: boolean;
  writerStatus: WriterLeaseStatus;
  onTakeOver: () => void;
  onRestore: () => void;
  onExport: (scope: "page" | "all") => void;
  onExportPage: (format: "svg" | "png" | "print") => void;
  onImport: (file: File) => void;
};

const SAVE_LABELS = { loading: "Opening…", saving: "Saving…", saved: "Saved", error: "Save failed" } as const;
const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * The page's own controls in the canvas's top-left corner: the page list
 * toggle, the title, whether the last change reached storage, and a menu for
 * archive, export and recovery actions that are used too rarely to stay on screen.
 */
export function NotebookBar({
  title, activePageId, pagesOpen, onTogglePages, onRename, saveStatus, saveError, storageSummary, canRestore,
  transferStatus, onDismissTransferStatus, isOnline, writerStatus, onTakeOver, onRestore, onExport, onExportPage, onImport,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const canEdit = writerStatus === "writer";

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);
  useEffect(() => {
    if (!canEdit) setRenaming(false);
  }, [canEdit]);

  const finishRename = () => {
    if (!renaming) return;
    setRenaming(false);
    if (draftTitle.trim() && draftTitle !== title) onRename(draftTitle);
  };

  return (
    <div className="notebook-bar-stack">
      <div className="notebook-bar canvas-chrome">
        <button
          type="button"
          className="icon-button"
          aria-label={pagesOpen ? "Hide pages" : "Show pages"}
          title={pagesOpen ? "Hide pages (Ctrl+\\)" : "Show pages (Ctrl+\\)"}
          aria-keyshortcuts="Control+Backslash"
          aria-expanded={pagesOpen}
          aria-controls="page-sidebar"
          onClick={onTogglePages}
        >
          <PanelLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <h1 className="notebook-bar__title">
          {renaming ? (
            <input
              ref={inputRef}
              value={draftTitle}
              maxLength={80}
              aria-label="Page title"
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") finishRename();
                if (event.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              title={canEdit ? "Rename this page" : undefined}
              disabled={!canEdit || !title}
              onClick={() => {
                setDraftTitle(title ?? "");
                setRenaming(true);
              }}
            >
              {title ?? "Opening notebook…"}
            </button>
          )}
        </h1>
        <span className="save-pill" data-status={saveStatus} role="status" title={saveStatus === "saved" ? "Every change is saved on this device" : undefined}>
          <span className="save-dot" aria-hidden="true" />
          {SAVE_LABELS[saveStatus]}
        </span>
        {!isOnline && (
          <span className="offline-pill" title="Writing and saving work offline; AI actions need a connection">
            <WifiOff size={14} aria-hidden="true" /> Offline
          </span>
        )}
        <MenuButton label="Notebook menu" icon={<Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />}>
          {(close) => (
            <>
              <p className="menu-heading">This page</p>
              <button type="button" className="menu-item" onClick={() => { close(); onExport("page"); }} disabled={saveStatus !== "saved" || !activePageId} title="Download only this page, with its images and quiz answers, as an .ainotebook file">
                <Archive {...ICON} /> Archive page
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); onExportPage("svg"); }} disabled={!activePageId}>
                <Download {...ICON} /> Export as SVG
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); onExportPage("png"); }} disabled={!activePageId}>
                <FileImage {...ICON} /> Export as PNG
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); onExportPage("print"); }} disabled={!activePageId}>
                <Printer {...ICON} /> Print or save as PDF
              </button>
              {canRestore && (
                <button type="button" className="menu-item" onClick={() => { close(); onRestore(); }} disabled={!canEdit} title="Bring back this page as it was before its last save">
                  <RotateCcw {...ICON} /> Restore previous version
                </button>
              )}
              <hr />
              <p className="menu-heading">Notebook</p>
              <button type="button" className="menu-item" onClick={() => { close(); onExport("all"); }} disabled={saveStatus !== "saved"} title="Download every page plus uploaded sources and chat history, to back up or move the whole notebook">
                <Archive {...ICON} /> Back up all
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); archiveInputRef.current?.click(); }} disabled={saveStatus !== "saved" || !canEdit}>
                <Upload {...ICON} /> Import archive…
              </button>
              {storageSummary && <p className="menu-footnote">{storageSummary}</p>}
            </>
          )}
        </MenuButton>
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
      </div>

      {saveError && (
        <p className="chrome-notice chrome-notice--error" role="alert">
          <TriangleAlert {...ICON} /> {saveError}
        </p>
      )}
      {(writerStatus === "reader" || writerStatus === "unsupported") && (
        <p className="chrome-notice chrome-notice--warning" role="status">
          {writerStatus === "reader" ? "Read-only: another tab is editing" : "Read-only: tab locking unavailable"}
          {writerStatus === "reader" && <button type="button" onClick={onTakeOver}>Take over editing</button>}
        </p>
      )}
      {transferStatus && (
        <p className="chrome-notice" role="status">
          <span>{transferStatus}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" title="Dismiss" onClick={onDismissTransferStatus}><X size={16} aria-hidden="true" /></button>
        </p>
      )}
    </div>
  );
}
