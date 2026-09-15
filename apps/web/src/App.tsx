import { useCallback, useEffect, useRef, useState } from "react";
import { KonvaPrototype } from "./canvas/KonvaPrototype";
import { PageSidebar } from "./components/PageSidebar";
import type { NotebookObject } from "./domain/notebook";
import { createNotebookPage, pageFromFixture, renamePage, replacePageObjects, type NotebookPage } from "./domain/pages";
import { phaseZeroFixture } from "./fixtures/phaseZeroFixture";
import { createNotebookArchive, MAX_ARCHIVE_BYTES, NOTEBOOK_ARCHIVE_MIME, readNotebookArchive } from "./persistence/notebookArchive";
import { cleanupOrphanAssets, deletePage, hasRecoverySnapshot, loadAssets, loadPages, restorePreviousPage, savePage, storeImportedNotebook } from "./persistence/notebookDatabase";
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

  const updateActivePageObjects = useCallback((objects: NotebookObject[]) => {
    if (writerStatus !== "writer") return;
    const current = pagesRef.current.find((page) => page.id === activePageId);
    if (!current) return;
    const updated = replacePageObjects(current, objects);
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
      const assets = await loadAssets(assetHashes);
      const archive = await createNotebookArchive(pagesRef.current, assets);
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      const blob = new Blob([archiveBuffer], { type: NOTEBOOK_ARCHIVE_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-notebook-${new Date().toISOString().slice(0, 10)}.ainotebook`;
      link.click();
      URL.revokeObjectURL(url);
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
      const imported = await readNotebookArchive(new Uint8Array(await file.arrayBuffer()), Date.now(), () => crypto.randomUUID(), existingPageIds);
      await storeImportedNotebook(imported.pages, imported.assets);
      replacePages([...pagesRef.current, ...imported.pages]);
      setActivePageId(imported.pages[0].id);
      setCanvasGeneration((current) => current + 1);
      setCanRestore(false);
      setSaveStatus("saved");
      setSaveError(undefined);
      scheduleAssetCleanup();
      setTransferStatus(`Imported ${imported.pages.length} page${imported.pages.length === 1 ? "" : "s"} as copies`);
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "Notebook import failed");
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
        onOpen={setActivePageId}
        onRename={renameNotebookPage}
        onDelete={deleteNotebookPage}
        onRestore={restoreActivePage}
        onExport={() => { void exportNotebook(); }}
        onImport={(file) => { void importNotebook(file); }}
        onTakeOver={() => writerLeaseRef.current?.takeOver()}
      />

      <div className="notebook-workspace">
        <header className="app-header">
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
          <KonvaPrototype key={`${activePage.id}:${canvasGeneration}`} fixture={activePage} readOnly={writerStatus !== "writer"} onObjectsChange={updateActivePageObjects} />
        )}
      </div>
    </main>
  );
}
