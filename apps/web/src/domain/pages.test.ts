import { describe, expect, it, vi } from "vitest";
import { createNotebookPage, movePage, normalizePageTitle, orderPages, renamePage, replacePageObjects } from "./pages";

describe("notebook pages", () => {
  it("creates an independent empty page with a stable title", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "new-id" });
    const page = createNotebookPage("  Page   2  ", 100);
    expect(page).toMatchObject({ id: "page-new-id", title: "Page 2", objects: [], createdAt: 100, updatedAt: 100 });
    vi.unstubAllGlobals();
  });

  it("does not erase a page title when an empty rename is submitted", () => {
    const page = { ...createNotebookPage("Dynamics", 100), id: "page-1" };
    expect(renamePage(page, "   ", 200).title).toBe("Dynamics");
  });

  it("normalizes whitespace in sidebar titles", () => {
    expect(normalizePageTitle("  Energy   and work ")).toBe("Energy and work");
  });

  it("advances the page revision timestamp even when the clock does not", () => {
    const page = { ...createNotebookPage("Dynamics", 100), id: "page-1" };
    const renamed = renamePage(page, "Motion", 100);
    const changed = replacePageObjects(renamed, [], 99);
    expect(renamed.updatedAt).toBe(101);
    expect(changed.updatedAt).toBe(102);
  });
});

describe("page order", () => {
  const page = (id: string, createdAt: number) => ({ id, createdAt });

  it("follows the saved order, then creation order for pages it does not mention", () => {
    const pages = [page("a", 1), page("b", 2), page("c", 3), page("new", 4)];
    expect(orderPages(pages, ["c", "gone", "a", "b"]).map((entry) => entry.id)).toEqual(["c", "a", "b", "new"]);
    expect(orderPages(pages, []).map((entry) => entry.id)).toEqual(["a", "b", "c", "new"]);
  });

  it("moves a page to a clamped position without losing any", () => {
    const pages = [page("a", 1), page("b", 2), page("c", 3)];
    expect(movePage(pages, "a", 2).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(movePage(pages, "c", -5).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(movePage(pages, "missing", 0).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});
