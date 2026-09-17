import { describe, expect, it } from "vitest";
import type { NotebookPage } from "../domain/pages";
import { createStaticPageSvg, getStaticPageBounds, safeExportFilename } from "./staticPageExport";

const page: NotebookPage = {
  schemaVersion: 3,
  id: "page-export",
  title: "Motion & forces",
  width: 100,
  height: 80,
  createdAt: 1,
  updatedAt: 2,
  aiTransactions: [],
  objects: [
    { id: "note", revision: 1, kind: "text-card", x: -50, y: 10, width: 80, height: 60, title: "A < B", body: "Off-screen note" },
    { id: "node", revision: 1, kind: "graph-node", x: 140, y: 20, width: 60, height: 40, label: "Force" },
    { id: "edge", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "note", toId: "node", label: "links" },
    { id: "ink", revision: 1, kind: "stroke", tool: "pen", color: "#123456", size: 4, x: 0, y: 0, width: 10, height: 10, points: [{ x: 4, y: 4, pressure: 0.5, time: 0 }, { x: 14, y: 14, pressure: 0.5, time: 1 }] },
  ],
};

describe("static page export", () => {
  it("expands beyond page bounds so off-screen objects are included", () => {
    expect(getStaticPageBounds(page)).toEqual({ left: -82, top: -32, right: 232, bottom: 112 });
  });

  it("renders semantic cards, connectors, nodes, and ink without selection UI", async () => {
    const svg = await createStaticPageSvg(page, []);
    expect(svg).toContain('viewBox="-82 -32 314 144"');
    expect(svg).toContain("A &lt; B");
    expect(svg).toContain("Off-screen");
    expect(svg).toContain("Force");
    expect(svg).toContain("links");
    expect(svg).toContain('fill="#123456"');
    expect(svg).not.toContain("Resize");
  });

  it("exports converted handwriting as escaped text instead of its hidden source ink", async () => {
    const svg = await createStaticPageSvg({ ...page, objects: [
      { id: "word", revision: 1, kind: "ink-text", x: 5, y: 5, width: 80, height: 30, text: "F < ma", fontSize: 24, color: "#183153", recognizedText: "F < ma", recognizer: "test", sourceStrokes: [page.objects[3] as never] },
    ] }, []);
    expect(svg).toContain(">F &lt; ma</text>");
    expect(svg).toContain('font-size="24"');
    expect(svg).not.toContain('fill="#123456"');
  });

  it("exports each diagram as a titled group with routes between facing sides", async () => {
    const diagramPage: NotebookPage = { ...page, objects: [
      { id: "top", revision: 1, kind: "graph-node", x: 0, y: 0, width: 100, height: 60, label: "Cause" },
      { id: "bottom", revision: 1, kind: "graph-node", x: 0, y: 200, width: 100, height: 60, label: "Effect" },
      { id: "flow", revision: 1, kind: "connector", x: 0, y: 0, width: 0, height: 0, fromId: "top", toId: "bottom", label: "leads" },
    ] };
    const svg = await createStaticPageSvg(diagramPage, []);
    expect(svg).toContain('<g role="group"><title>Diagram with 2 nodes: Cause; Effect\nCause to Effect: leads</title>');
    expect(svg).toContain('<line x1="50" y1="60" x2="50" y2="200"');
  });

  it("embeds referenced binary images and rejects missing assets", async () => {
    const imagePage: NotebookPage = { ...page, objects: [{ id: "image", revision: 1, kind: "image", x: 0, y: 0, width: 20, height: 20, assetHash: "a".repeat(64), mimeType: "image/png", name: "dot.png" }] };
    await expect(createStaticPageSvg(imagePage, [])).rejects.toThrow("is missing");
    const svg = await createStaticPageSvg(imagePage, [{ hash: "a".repeat(64), blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), mimeType: "image/png", size: 3, createdAt: 1 }]);
    expect(svg).toContain("data:image/png;base64,AQID");
  });

  it("creates a filesystem-safe SVG name", () => {
    expect(safeExportFilename("  Motion & forces!  ")).toBe("motion-forces.svg");
  });
});
