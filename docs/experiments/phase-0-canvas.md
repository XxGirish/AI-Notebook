# Phase 0 canvas comparison log

Status: concluded by product decision  
Started: 2026-09-14

## Purpose

This experiment rendered the same semantic learning scene through Excalidraw and a Konva hybrid. On 2026-09-14, the user selected Konva hybrid as the production direction. The Excalidraw implementation and dependency were then removed. A successful desktop render remains only an early integration check for Konva.

## Pinned environment

| Item | Version / environment |
|---|---|
| Node.js | 24.12.0 |
| npm | 11.6.2 |
| React / React DOM | 18.3.1 |
| Vite | 8.3.0 |
| TypeScript | 7.0.2 |
| Konva | 10.5.0 |
| react-konva | 18.2.16 |
| perfect-freehand | 1.2.3 |
| Excalidraw | 0.18.1 during comparison; removed after decision |
| KaTeX | 0.18.7 |
| Automated browser smoke test | Codex in-app browser, narrow desktop viewport |

The first install paired react-konva 19 with duplicate React 18/19 runtimes and failed at runtime. The spike now pins React 18.3.1 and react-konva 18.2.16 so both candidates share one React runtime.

## Implemented evidence

- One versioned fixture contains pressure-bearing pen samples, a highlighter, editable text/equation/quiz payloads, three graph nodes, and ID-bound connectors.
- Contract tests verify unique object IDs, connector targets, the quiz answer key, and the required object families.
- Konva projects the fixture into a base canvas, a React DOM card layer, and an upper ink canvas. The tested browser created a completed trial stroke, moved between interaction modes, and graded the correct quiz option locally.
- Moving a Konva graph node updates its connected arrows from stored endpoint IDs. Cards have an explicit drag handle so answering and moving are separate actions.
- During the comparison, Excalidraw received the same fixture through `convertToExcalidrawElements`; its built-in drawing tool created a stroke and enabled undo.
- Type checking, the focused fixture tests, and a production Vite build pass.

## Observed limitations and open gates

- No physical pen or touch hardware has been tested. Pressure quality, palm behavior, pinch/pen arbitration, cancellation, rotation, and background/resume remain unverified.
- Konva does not yet have camera pan/zoom, lasso, whole-stroke erasing, command history, persistence, or a complete export compositor.
- The current narrow-viewport Konva scene exposes only the left portion of the fixed world. Camera navigation is the next interaction task.
- Excalidraw cards were ordinary labeled canvas shapes in the comparison adapter. Its interactive embeddable and export gates were not pursued after the Konva decision.
- Save/reopen, connected-diagram duplication/remapping, one-step mock AI batch undo, schema migration, normal/stress fixtures, and measured frame timings are not implemented.
- The Excalidraw editor bundle and its nine recorded transitive advisories were removed with the dependency.

## Next comparison slice

1. Add a small world-coordinate camera controller with mouse/touch pan and wheel/pinch zoom to the Konva prototype.
2. Add semantic save/reopen and a shared command batch with undo/redo.
3. Build an all-layer raster export and prove that the equation and quiz are present.
4. Generate normal and stress fixtures, add frame instrumentation, then run the prescribed physical-device script.
