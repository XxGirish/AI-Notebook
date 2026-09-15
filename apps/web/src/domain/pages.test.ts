import { describe, expect, it, vi } from "vitest";
import { createNotebookPage, normalizePageTitle, renamePage, replacePageObjects } from "./pages";

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
