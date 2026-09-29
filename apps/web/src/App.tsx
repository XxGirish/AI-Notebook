import { useCallback, useEffect, useRef, useState } from "react";
import { KonvaPrototype, type CanvasInsertOutcome, type CanvasInsertRequest } from "./canvas/KonvaPrototype";
import { ChatDock } from "./components/chat/ChatDock";
import { useMediaQuery } from "./components/useMediaQuery";
import { PageSidebar } from "./components/PageSidebar";
import type { AiTransactionRecord, NotebookObject } from "./domain/notebook";
import { createNotebookPage, movePage, pageFromFixture, renamePage, replacePageObjects, setPagePaper, type NotebookPage } from "./domain/pages";
import type { PaperStyle } from "./domain/paper";
import { phaseZeroFixture } from "./fixtures/phaseZeroFixture";
import { createStaticPageSvg, getStaticPageBounds, safeExportFilename } from "./export/staticPageExport";
import { printSvg, svgToPngBlob } from "./export/rasterExport";
import { createNotebookArchive, MAX_ARCHIVE_BYTES, NOTEBOOK_ARCHIVE_MIME, readNotebookArchive } from "./persistence/notebookArchive";
import { cleanupOrphanAssets, deletePage, hasRecoverySnapshot, loadAssets, loadLibrary, loadPages, loadSources, restorePreviousPage, savePage, savePageOrder, storeImportedNotebook } from "./persistence/notebookDatabase";
import { PageWriteConflictError } from "./persistence/pageRecords";
import { formatStorageEstimate, storageFailureMessage } from "./persistence/storageHealth";
import { createWriterLease, type WriterLeaseStatus, type WriterLockManager } from "./persistence/writerLease";
import { registerNotebookServiceWorker, type NotebookServiceWorker } from "./pwa/serviceWorkerRegistration";
import { canActivateAppUpdate, hasUncommittedNotebookChanges } from "./pwa/updatePolicy";

export function App() {
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [activePageId, setActivePageId] = useState("");
  const [saveStatus, setSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [canRestore, setCanRestore] = useState(false);
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  const [libraryGeneration, setLibraryGeneration] = useState(0);
  // Below 900px the page list is a drawer; see styles.css.
  const narrowLayout = useMediaQuery("(max-width: 900px)");
  const [pagesOpen, setPagesOpen] = useState(false);
  const pagesToggleRef = useRef<HTMLButtonElement>(null);
  const sidebarSlotRef = useRef<HTMLDivElement>(null);
  // Off-screen on a narrow layout, the list is inert: out of the tab order and
  // the accessibility tree. React 18 has no `inert` prop, so it is set directly.
  useEffect(() => {
    const slot = sidebarSlotRef.current;
    if (!slot) return;
    slot.inert = narrowLayout && !pagesOpen;
    if (narrowLayout && pagesOpen) slot.querySelector<HTMLElement>(".page-link[aria-current='page'], .page-link")?.focus();
  }, [narrowLayout, pagesOpen]);
  const [transferStatus, setTransferStatus] = useState<string>();
  const [writerStatus, setWriterStatus] = useState<WriterLeaseStatus>("checking");
  const [saveError, setSaveError] = useState<string>();
  const [storageSummary, setStorageSummary] = useState<string>();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "offline-ready" | "ready" | "applying" | "error">("idle");
  const [updateError, setUpdateError] = useState<string>();
  const pagesRef = useRef<NotebookPage[]>([]);
  const activePageIdRef = useRef("");
  const saveSequenceRef = useRef(0);
  const writerLeaseRef = useRef<ReturnType<typeof createWriterLease>>();
  const assetCleanupTimerRef = useRef<number>();
  const serviceWorkerRef = useRef<NotebookServiceWorker>();
  const [canvasInsert, setCanvasInsert] = useState<CanvasInsertRequest>();
  const insertResolversRef = useRef(new Map<string, (outcome: CanvasInsertOutcome) => void>());

  /** The chat asks; the open page's canvas validates, lays out and commits the card as one undoable step. */
  const addChatAnswerToPage = useCallback((answer: Omit<CanvasInsertRequest, "id">) => new Promise<CanvasInsertOutcome>((resolve) => {
    if (!activePageIdRef.current) {
      resolve({ ok: false, message: "Open a page first." });
      return;
    }
    const id = crypto.randomUUID();
    insertResolversRef.current.set(id, resolve);
    setCanvasInsert({ ...answer, id });
  }), []);

  const handleCanvasInsert = useCallback((id: string, outcome: CanvasInsertOutcome) => {
    insertResolversRef.current.get(id)?.(outcome);
    insertResolversRef.current.delete(id);
    // Cleared so a canvas remounted for another page never sees a request meant for this one.
    setCanvasInsert((current) => (current?.id === id ? undefined : current));
  }, []);

  const replacePages = (next: NotebookPage[]) => {
    pagesRef.current = next;
    setPages(next);
  };

  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const serviceWorker = registerNotebookServiceWorker({
      onOfflineReady: () => setUpdateStatus((current) => current === "idle" ? "offline-ready" : current),
      onUpdateReady: () => setUpdateStatus("ready"),
      onError: (message) => {
        setUpdateStatus("error");
        setUpdateError(message);
      },
    });
    serviceWorkerRef.current = serviceWorker;
    return () => {
      serviceWorker?.dispose();
      if (serviceWorkerRef.current === serviceWorker) serviceWorkerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!hasUncommittedNotebookChanges(saveStatus)) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveStatus]);

  const refreshStoredPages = async () => {
    const storedPages = await loadPages();
    if (storedPages.length === 0) return storedPages;
    replacePages(storedPages);
    const preferredId = storedPages.some((page) => page.id === activePageIdRef.current)
      ? activePageIdRef.current
      : storedPages[0].id;
    setActivePageId(preferredId);
    setCanRestore(await hasRecoverySnapshot(preferredId));
    setCanvasGeneration((current) => current + 1);
    return storedPages;
  };

  const refreshStorageSummary = async () => {
    try {
      const estimate = await navigator.storage?.estimate();
      if (estimate) setStorageSummary(formatStorageEstimate(estimate));
    } catch {
      setStorageSummary(undefined);
    }
  };

  const cancelScheduledAssetCleanup = () => {
    if (assetCleanupTimerRef.current === undefined) return;
    window.clearTimeout(assetCleanupTimerRef.current);
    assetCleanupTimerRef.current = undefined;
  };

  const scheduleAssetCleanup = () => {
    cancelScheduledAssetCleanup();
    assetCleanupTimerRef.current = window.setTimeout(() => {
      assetCleanupTimerRef.current = undefined;
      void cleanupOrphanAssets().then(() => refreshStorageSummary(), () => undefined);
    }, 1_500);
  };

  const handleWriteFailure = (error: unknown, sequence: number) => {
    if (saveSequenceRef.current !== sequence) return;
    setSaveStatus("error");
    setSaveError(storageFailureMessage(error));
    if (error instanceof PageWriteConflictError) {
      writerLeaseRef.current?.stop();
      setWriterStatus("reader");
      setTransferStatus("Editing stopped because this notebook changed in another tab.");
      void refreshStoredPages();
    }
  };

  const persist = (page: NotebookPage, expectedUpdatedAt?: number) => {
    if (writerStatus !== "writer") return;
    cancelScheduledAssetCleanup();
    const sequence = ++saveSequenceRef.current;
    setSaveStatus("saving");
    setSaveError(undefined);
    void savePage(page, expectedUpdatedAt).then(
      ({ hasRecovery }) => {
        if (saveSequenceRef.current === sequence) {
          setSaveStatus("saved");
          scheduleAssetCleanup();
          if (page.id === activePageId) setCanRestore(hasRecovery);
        }
      },
      (error) => handleWriteFailure(error, sequence),
    );
  };

  useEffect(() => {
    let cancelled = false;
    const hydrate = async (createIfEmpty: boolean) => {
      try {
        const storedPages = await refreshStoredPages();
        if (cancelled || storedPages.length > 0) {
          if (!cancelled) setSaveStatus("saved");
          return;
        }

        const firstPage = pageFromFixture(phaseZeroFixture);
        if (createIfEmpty) await savePage(firstPage);
        if (cancelled) return;
        replacePages([firstPage]);
        setActivePageId(firstPage.id);
        setSaveStatus(createIfEmpty ? "saved" : "loading");
      } catch (error) {
        if (cancelled) return;
        const fallbackPage = pageFromFixture(phaseZeroFixture);
        replacePages([fallbackPage]);
        setActivePageId(fallbackPage.id);
        setSaveStatus("error");
        setSaveError(storageFailureMessage(error));
      }
    };

    const manager = "locks" in navigator ? navigator.locks as unknown as WriterLockManager : undefined;
    const lease = createWriterLease({
      manager,
      onGranted: async () => {
        await hydrate(true);
        if (cancelled) return;
        await cleanupOrphanAssets().catch(() => undefined);
        await refreshStorageSummary();
      },
      onStatus: (status) => {
        if (cancelled) return;
        setWriterStatus(status);
        if (status === "reader" || status === "unsupported") {
          void hydrate(false).then(() => refreshStorageSummary());
        }
      },
    });
    writerLeaseRef.current = lease;
    lease.start();
    return () => {
      cancelled = true;
      cancelScheduledAssetCleanup();
      lease.stop();
      if (writerLeaseRef.current === lease) writerLeaseRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!activePageId) return;
    let cancelled = false;
    void hasRecoverySnapshot(activePageId).then((available) => {
      if (!cancelled) setCanRestore(available);
    }, () => {
      if (!cancelled) setCanRestore(false);
    });
    return () => { cancelled = true; };
  }, [activePageId]);

  const createPage = () => {
    if (writerStatus !== "writer") return;
    const page = createNotebookPage(`Page ${pagesRef.current.length + 1}`);
    replacePages([...pagesRef.current, page]);
    setActivePageId(page.id);
    persist(page);
  };

  const renameNotebookPage = (pageId: string, title: string) => {
    if (writerStatus !== "writer") return;
    const current = pagesRef.current.find((page) => page.id === pageId);
    if (!current) return;
    const renamed = renamePage(current, title);
    replacePages(pagesRef.current.map((page) => page.id === pageId ? renamed : page));
    persist(renamed, current.updatedAt);
  };

  /** Moves a page in the sidebar; the order is saved like any other change, with an honest status. */
  const reorderNotebookPage = (pageId: string, toIndex: number) => {
    if (writerStatus !== "writer") return;
    const next = movePage(pagesRef.current, pageId, toIndex);
    if (next.every((page, index) => page.id === pagesRef.current[index].id)) return;
    replacePages(next);
    const sequence = ++saveSequenceRef.current;
    setSaveStatus("saving");
    setSaveError(undefined);
    void savePageOrder(next.map((page) => page.id)).then(
      () => {
        if (saveSequenceRef.current === sequence) setSaveStatus("saved");
      },
      (error) => handleWriteFailure(error, sequence),
    );
  };

  const deleteNotebookPage = (pageId: string) => {
    if (writerStatus !== "writer") return;
    const index = pagesRef.current.findIndex((page) => page.id === pageId);
    if (index < 0) return;
    const deletingPage = pagesRef.current[index];

    let remaining = pagesRef.current.filter((page) => page.id !== pageId);
    let replacement: NotebookPage | undefined;
    if (remaining.length === 0) {
      replacement = createNotebookPage("Untitled page");
      remaining = [replacement];
    }

    replacePages(remaining);
    if (activePageId === pageId) {
      setActivePageId(remaining[Math.min(index, remaining.length - 1)].id);
    }

    const sequence = ++saveSequenceRef.current;
    cancelScheduledAssetCleanup();
    setSaveStatus("saving");
    setSaveError(undefined);
    void deletePage(pageId, deletingPage.updatedAt, replacement).then(
      () => {
        if (saveSequenceRef.current === sequence) {
          setSaveStatus("saved");
          scheduleAssetCleanup();
        }
      },
      (error) => handleWriteFailure(error, sequence),
    );
  };

  const updateActivePageObjects = useCallback((objects: NotebookObject[], aiTransaction?: AiTransactionRecord) => {
    if (writerStatus !== "writer") return;
    const current = pagesRef.current.find((page) => page.id === activePageId);
    if (!current) return;
    const withObjects = replacePageObjects(current, objects);
    const updated = aiTransaction && !current.aiTransactions.some((transaction) => transaction.transactionId === aiTransaction.transactionId)
      ? { ...withObjects, aiTransactions: [...current.aiTransactions, aiTransaction] }
      : withObjects;
    replacePages(pagesRef.current.map((page) => page.id === activePageId ? updated : page));
    persist(updated, current.updatedAt);
  }, [activePageId, writerStatus]);

  const setActivePagePaper = useCallback((paper: PaperStyle | undefined) => {
    if (writerStatus !== "writer") return;
    const current = pagesRef.current.find((page) => page.id === activePageId);
    if (!current || current.paper === paper) return;
    const updated = setPagePaper(current, paper);
    replacePages(pagesRef.current.map((page) => page.id === activePageId ? updated : page));
    persist(updated, current.updatedAt);
  }, [activePageId, writerStatus]);

  const restoreActivePage = () => {
    if (writerStatus !== "writer") return;
    if (!activePageId) return;
    const sequence = ++saveSequenceRef.current;
    cancelScheduledAssetCleanup();
    setSaveStatus("saving");
    setSaveError(undefined);
    const expectedUpdatedAt = pagesRef.current.find((page) => page.id === activePageId)?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    void restorePreviousPage(activePageId, expectedUpdatedAt).then(
      (restored) => {
        if (!restored) {
          if (saveSequenceRef.current === sequence) {
            setSaveStatus("saved");
            setCanRestore(false);
            scheduleAssetCleanup();
          }
          return;
        }
        replacePages(pagesRef.current.map((page) => page.id === restored.id ? restored : page));
        setCanvasGeneration((current) => current + 1);
        if (saveSequenceRef.current === sequence) {
          setSaveStatus("saved");
          setCanRestore(true);
          scheduleAssetCleanup();
        }
      },
      (error) => handleWriteFailure(error, sequence),
    );
  };

  const exportNotebook = async () => {
    setTransferStatus("Preparing export…");
    try {
      const assetHashes = pagesRef.current.flatMap((page) => page.objects.filter((object) => object.kind === "image").map((object) => object.assetHash));
      const [assets, library] = await Promise.all([loadAssets(assetHashes), loadLibrary()]);
      const archive = await createNotebookArchive(pagesRef.current, assets, undefined, library);
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      const blob = new Blob([archiveBuffer], { type: NOTEBOOK_ARCHIVE_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-notebook-${new Date().toISOString().slice(0, 10)}.ainotebook`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setTransferStatus(`Exported ${pagesRef.current.length} page${pagesRef.current.length === 1 ? "" : "s"}`);
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "Notebook export failed");
    }
  };

  const importNotebook = async (file: File) => {
    if (writerStatus !== "writer") return;
    if (file.size > MAX_ARCHIVE_BYTES) {
      setTransferStatus("Import failed: the archive exceeds 64 MB");
      return;
    }
    setTransferStatus("Validating import…");
    try {
      const existingPageIds = new Set(pagesRef.current.map((page) => page.id));
      const existingSourceIdsByHash = new Map((await loadSources()).map((source) => [source.contentHash, source.id]));
      const imported = await readNotebookArchive(new Uint8Array(await file.arrayBuffer()), { reservedPageIds: existingPageIds, existingSourceIdsByHash });
      await storeImportedNotebook(imported.pages, imported.assets, imported);
      if (imported.sources.length > 0 || imported.chatMessages.length > 0) setLibraryGeneration((current) => current + 1);
      replacePages([...pagesRef.current, ...imported.pages]);
      setActivePageId(imported.pages[0].id);
      setCanvasGeneration((current) => current + 1);
      setCanRestore(false);
      setSaveStatus("saved");
      setSaveError(undefined);
      scheduleAssetCleanup();
      const librarySummary = [
        imported.sources.length > 0 ? `${imported.sources.length} source${imported.sources.length === 1 ? "" : "s"}` : "",
        imported.chatMessages.length > 0 ? `${imported.chatMessages.length} chat message${imported.chatMessages.length === 1 ? "" : "s"}` : "",
        imported.quizAttempts.length > 0 ? `${imported.quizAttempts.length} quiz answer${imported.quizAttempts.length === 1 ? "" : "s"}` : "",
        imported.aiFeedback.length > 0 ? `${imported.aiFeedback.length} AI report${imported.aiFeedback.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(", ");
      setTransferStatus(`Imported ${imported.pages.length} page${imported.pages.length === 1 ? "" : "s"} as copies${librarySummary ? `, with ${librarySummary}` : ""}`);
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "Notebook import failed");
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  /** SVG, PNG and print all start from the same document-driven SVG of the active page. */
  const exportActivePage = async (format: "svg" | "png" | "print") => {
    const page = pagesRef.current.find((candidate) => candidate.id === activePageIdRef.current);
    if (!page) return;
    setTransferStatus(format === "print" ? "Preparing the page for printing…" : "Rendering static page…");
    try {
      const hashes = page.objects.filter((object) => object.kind === "image").map((object) => object.assetHash);
      const assets = await loadAssets(hashes);
      const svg = await createStaticPageSvg(page, assets);
      if (format === "svg") {
        downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), safeExportFilename(page.title));
        setTransferStatus(`Exported “${page.title}” as SVG`);
      } else if (format === "png") {
        const bounds = getStaticPageBounds(page);
        downloadBlob(await svgToPngBlob(svg, bounds.right - bounds.left, bounds.bottom - bounds.top), safeExportFilename(page.title, "png"));
        setTransferStatus(`Exported “${page.title}” as PNG`);
      } else {
        await printSvg(svg, page.title);
        setTransferStatus(`Sent “${page.title}” to the print dialog`);
      }
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "Static page export failed");
    }
  };

  const activePage = pages.find((page) => page.id === activePageId);
  const updateCanApply = canActivateAppUpdate(saveStatus);

  const applyAppUpdate = () => {
    if (!updateCanApply) return;
    setUpdateStatus("applying");
    if (!serviceWorkerRef.current?.applyUpdate()) {
      setUpdateStatus("error");
      setUpdateError("The prepared update is no longer available. Reload when your notebook is saved to check again.");
    }
  };

  return (
    <main className="app-shell">
      <button type="button" className="pages-backdrop" data-open={narrowLayout && pagesOpen} aria-label="Close the page list" tabIndex={-1} onClick={() => setPagesOpen(false)} />
      <div
        className="page-sidebar-slot"
        ref={sidebarSlotRef}
        data-open={narrowLayout && pagesOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && narrowLayout && pagesOpen) {
            setPagesOpen(false);
            pagesToggleRef.current?.focus();
          }
        }}
      >
      <PageSidebar
        pages={pages}
        activePageId={activePageId}
        saveStatus={saveStatus}
        saveError={saveError}
        storageSummary={storageSummary}
        canRestore={canRestore}
        transferStatus={transferStatus}
        writerStatus={writerStatus}
        onCreate={createPage}
        onOpen={(pageId) => {
          setActivePageId(pageId);
          setPagesOpen(false);
        }}
        onRename={renameNotebookPage}
        onReorder={reorderNotebookPage}
        onDelete={deleteNotebookPage}
        onRestore={restoreActivePage}
        onExport={() => { void exportNotebook(); }}
        onExportPage={(format) => { void exportActivePage(format); }}
        onImport={(file) => { void importNotebook(file); }}
        onTakeOver={() => writerLeaseRef.current?.takeOver()}
      />
      </div>

      <div className="notebook-workspace">
        <header className="app-header">
          <button
            ref={pagesToggleRef}
            type="button"
            className="pages-toggle"
            aria-expanded={pagesOpen}
            onClick={() => setPagesOpen((open) => !open)}
          >
            <span aria-hidden="true">☰</span> Pages
          </button>
          <div>
            <p className="eyebrow">Reliable offline notebook · Phase 1</p>
            <h1>{activePage?.title ?? "Opening notebook…"}</h1>
            <p>Konva canvas rendering with accessible React learning cards.</p>
          </div>
          <div className="app-header__badges">
            <span className="network-badge" data-online={isOnline}>{isOnline ? "Online" : "Offline"}</span>
            <div className="engine-badge">Konva hybrid</div>
          </div>
        </header>

        {updateStatus === "ready" && (
          <aside className="app-update-banner" role="status">
            <span>{updateCanApply ? "An application update is ready." : "An update is ready and will wait until notebook changes are saved."}</span>
            <button type="button" onClick={applyAppUpdate} disabled={!updateCanApply}>Update and reload</button>
          </aside>
        )}
        {updateStatus === "applying" && <aside className="app-update-banner" role="status">Applying the saved update…</aside>}
        {updateStatus === "error" && <aside className="app-update-banner app-update-banner--error" role="alert">Offline update error: {updateError}</aside>}

        <aside className="experiment-banner">
          <strong>Editable learning objects are live.</strong>
          <span>Create notes, shapes, and content-hashed images; then resize, connect, or group them with local persistence.</span>
        </aside>

        {activePage && (
          <KonvaPrototype
            key={`${activePage.id}:${canvasGeneration}`}
            fixture={activePage}
            readOnly={writerStatus !== "writer"}
            onObjectsChange={updateActivePageObjects}
            insertRequest={canvasInsert}
            onInsertRequestHandled={handleCanvasInsert}
            onPaperChange={setActivePagePaper}
          />
        )}
      </div>

      <ChatDock
        pages={pages}
        activePageId={activePageId}
        isOnline={isOnline}
        readOnly={writerStatus !== "writer"}
        onAddToPage={addChatAnswerToPage}
        onOpenPage={setActivePageId}
        libraryGeneration={libraryGeneration}
      />
    </main>
  );
}
