import { useCallback, useEffect, useRef, useState } from "react";
import { KonvaPrototype } from "./canvas/KonvaPrototype";
import { PageSidebar } from "./components/PageSidebar";
import type { NotebookObject } from "./domain/notebook";
import { createNotebookPage, pageFromFixture, renamePage, replacePageObjects, type NotebookPage } from "./domain/pages";
import { phaseZeroFixture } from "./fixtures/phaseZeroFixture";
import { deletePage, loadPages, savePage } from "./persistence/notebookDatabase";

export function App() {
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [activePageId, setActivePageId] = useState("");
  const [saveStatus, setSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const pagesRef = useRef<NotebookPage[]>([]);
  const saveSequenceRef = useRef(0);

  const replacePages = (next: NotebookPage[]) => {
    pagesRef.current = next;
    setPages(next);
  };

  const persist = (page: NotebookPage) => {
    const sequence = ++saveSequenceRef.current;
    setSaveStatus("saving");
    void savePage(page).then(
      () => {
        if (saveSequenceRef.current === sequence) setSaveStatus("saved");
      },
      () => {
        if (saveSequenceRef.current === sequence) setSaveStatus("error");
      },
    );
  };

  useEffect(() => {
    let cancelled = false;
    void loadPages().then(async (storedPages) => {
      if (cancelled) return;
      if (storedPages.length > 0) {
        replacePages(storedPages);
        setActivePageId(storedPages[0].id);
        setSaveStatus("saved");
        return;
      }

      const firstPage = pageFromFixture(phaseZeroFixture);
      replacePages([firstPage]);
      setActivePageId(firstPage.id);
      persist(firstPage);
    }).catch(() => {
      if (cancelled) return;
      const fallbackPage = pageFromFixture(phaseZeroFixture);
      replacePages([fallbackPage]);
      setActivePageId(fallbackPage.id);
      setSaveStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const createPage = () => {
    const page = createNotebookPage(`Page ${pagesRef.current.length + 1}`);
    replacePages([...pagesRef.current, page]);
    setActivePageId(page.id);
    persist(page);
  };

  const renameNotebookPage = (pageId: string, title: string) => {
    const current = pagesRef.current.find((page) => page.id === pageId);
    if (!current) return;
    const renamed = renamePage(current, title);
    replacePages(pagesRef.current.map((page) => page.id === pageId ? renamed : page));
    persist(renamed);
  };

  const deleteNotebookPage = (pageId: string) => {
    const index = pagesRef.current.findIndex((page) => page.id === pageId);
    if (index < 0) return;

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
    setSaveStatus("saving");
    void Promise.all([deletePage(pageId), replacement ? savePage(replacement) : Promise.resolve()]).then(
      () => {
        if (saveSequenceRef.current === sequence) setSaveStatus("saved");
      },
      () => {
        if (saveSequenceRef.current === sequence) setSaveStatus("error");
      },
    );
  };

  const updateActivePageObjects = useCallback((objects: NotebookObject[]) => {
    const current = pagesRef.current.find((page) => page.id === activePageId);
    if (!current) return;
    const updated = replacePageObjects(current, objects);
    replacePages(pagesRef.current.map((page) => page.id === activePageId ? updated : page));
    persist(updated);
  }, [activePageId]);

  const activePage = pages.find((page) => page.id === activePageId);

  return (
    <main className="app-shell">
      <PageSidebar
        pages={pages}
        activePageId={activePageId}
        saveStatus={saveStatus}
        onCreate={createPage}
        onOpen={setActivePageId}
        onRename={renameNotebookPage}
        onDelete={deleteNotebookPage}
      />

      <div className="notebook-workspace">
        <header className="app-header">
          <div>
            <p className="eyebrow">Editor foundation · Milestone 2</p>
            <h1>{activePage?.title ?? "Opening notebook…"}</h1>
            <p>Konva canvas rendering with accessible React learning cards.</p>
          </div>
          <div className="engine-badge">Konva hybrid</div>
        </header>

        <aside className="experiment-banner">
          <strong>Local page history is live.</strong>
          <span>Create, open, and rename independent pages. Committed canvas edits are saved to this browser.</span>
        </aside>

        {activePage && (
          <KonvaPrototype key={activePage.id} fixture={activePage} onObjectsChange={updateActivePageObjects} />
        )}
      </div>
    </main>
  );
}
