import { describe, expect, it } from "vitest";
import { collectDiagrams, diagramAdapter } from "../domain/diagramAdapter";
import type { GraphNodeObject, NotebookObject } from "../domain/notebook";
import { createNotebookPage } from "../domain/pages";
import { mockLessonProposal, validateCanvasProposal } from "@ai-notebook/ai-contract";
import { createNotebookArchive, readNotebookArchive } from "../persistence/notebookArchive";
import { commitCanvasBatchToPage, prepareCanvasBatch } from "./proposalCompiler";

// Phase 2 exit evidence: a fixture lesson creates an editable diagram that stays
// correct after its nodes move and survives an archive round trip as a copy.
describe("fixture lesson diagram lifecycle", () => {
  it("keeps bindings, routes, and reading text through movement and archive import", async () => {
    const ink: NotebookObject = { id: "user-ink", revision: 1, kind: "stroke", tool: "pen", color: "#222222", size: 4, x: 0, y: 0, width: 10, height: 10, points: [{ x: 1, y: 1, pressure: 0.5, time: 0 }, { x: 9, y: 9, pressure: 0.5, time: 1 }] };
    const page = { ...createNotebookPage("Lesson", 10), id: "page-lesson", objects: [ink] };
    const proposal = validateCanvasProposal(mockLessonProposal, {
      requestId: "request-lesson",
      pageId: page.id,
      permittedOperations: new Set(["insert_lesson_section"]),
      targetObjects: new Map(),
      maxOperations: 1,
    });
    let nextId = 0;
    const batch = prepareCanvasBatch({
      transactionId: "transaction-lesson",
      pageId: page.id,
      existingObjects: page.objects,
      proposal,
      provenance: { requestId: "request-lesson", intent: "teach_section", provider: "mock", model: "fixture", configurationId: "mock-v1", proposalSchemaVersion: 1, sources: [] },
      viewportCenter: { x: 640, y: 410 },
      idFactory: () => `generated-${++nextId}`,
    });
    const committed = commitCanvasBatchToPage(page, batch, 20);

    const [diagram, ...otherDiagrams] = collectDiagrams(committed.objects);
    expect(otherDiagrams).toEqual([]);
    expect(diagramAdapter.validate(diagram)).toEqual([]);
    expect(diagram.connectors.length).toBeGreaterThan(0);
    const readingText = diagramAdapter.toPlainText(diagram);
    expect(committed.objects).toContainEqual(ink);

    // Move one connected node far below the others, as a geometry-only edit.
    const moving = diagram.nodes.find((node) => diagram.connectors.some((connector) => connector.fromId === node.id || connector.toId === node.id))!;
    const moved = { ...committed, objects: committed.objects.map((object) => object.id === moving.id ? { ...object, x: moving.x + 40, y: moving.y + 900 } : object) };
    const [movedDiagram] = collectDiagrams(moved.objects);
    expect(movedDiagram.id).toBe(diagram.id);
    expect(diagramAdapter.validate(movedDiagram)).toEqual([]);
    // Reading order is spatial, so a move may reorder lines but must not change them.
    const sortedLines = (text: string) => text.split("\n").slice(1).sort();
    expect(sortedLines(diagramAdapter.toPlainText(movedDiagram))).toEqual(sortedLines(readingText));
    const movedReadingText = diagramAdapter.toPlainText(movedDiagram);
    const movedNode = movedDiagram.nodes.find((node) => node.id === moving.id)!;
    const touching = diagramAdapter.render(movedDiagram).edges.filter((item) => item.fromId === moving.id || item.toId === moving.id);
    expect(touching.length).toBeGreaterThan(0);
    for (const edge of touching) {
      // The node now sits far below its neighbours, so each rerouted arrow meets its top edge.
      const end = edge.toId === moving.id ? { x: edge.route.x2, y: edge.route.y2 } : { x: edge.route.x1, y: edge.route.y1 };
      expect(end).toEqual({ x: movedNode.x + movedNode.width / 2, y: movedNode.y });
    }

    const archive = await createNotebookArchive([moved], [], "2026-09-17T00:00:00.000Z");
    let copyId = 0;
    const imported = await readNotebookArchive(archive, { now: 1_000, idFactory: () => `copy-${++copyId}` });
    const [importedDiagram] = collectDiagrams(imported.pages[0].objects);
    expect(diagramAdapter.validate(importedDiagram)).toEqual([]);
    expect(diagramAdapter.toPlainText(importedDiagram)).toBe(movedReadingText);

    const originalIds = new Set(moved.objects.map((object) => object.id));
    const importedModel = diagramAdapter.toExport(importedDiagram);
    expect(importedModel.nodes.every((node) => !originalIds.has(node.id))).toBe(true);
    const routesByLabels = (model: typeof importedModel, nodes: GraphNodeObject[]) => {
      const labels = new Map(nodes.map((node) => [node.id, node.label]));
      return model.edges.map((edge) => ({ from: labels.get(edge.fromId), to: labels.get(edge.toId), route: edge.route }))
        .sort((left, right) => `${left.from}>${left.to}`.localeCompare(`${right.from}>${right.to}`));
    };
    expect(routesByLabels(importedModel, importedDiagram.nodes)).toEqual(routesByLabels(diagramAdapter.toExport(movedDiagram), movedDiagram.nodes));
  });
});
