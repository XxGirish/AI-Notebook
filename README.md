# AI Notebook

AI Notebook is a local-first spatial learning notebook for writing, drawing, editing AI-created lessons, and answering quizzes in the same workspace.

The project is currently building on the selected **Konva hybrid** architecture: Konva + react-konva + perfect-freehand for ink and spatial graphics, with accessible React components for learning cards.

The current editor foundation includes a persistent page sidebar with create/open/rename/confirmed-delete actions backed by Dexie/IndexedDB, schema migration and reversible prior-version recovery, a world-coordinate camera with canvas-only Ctrl/Command+wheel zoom and a full-screen mode, pen/highlighter/eraser and navigation tools, editable text, equation, quiz, and diagram content, drag-to-size shapes, bound connectors, mixed-object grouping, and content-hashed image insertion with separately stored binary assets. Learning objects support movement, resizing, lasso/additive selection, relationship-safe duplication/deletion, shared undo/redo, and a spatially ordered linear reading view. Quiz edits retain stable option identities, equations retain editable LaTeX with a recoverable invalid-input fallback, and diagram label edits preserve connector endpoint bindings. Text, equation, and quiz cards share one adapter for validation, measurement, rendering, accessible plain text, static export, and migration. Versioned `.ainotebook` archives transfer pages, assets, and AI provenance with integrity validation and import-as-copy ID remapping; active pages also export as document-driven SVGs that include off-screen content. An exclusive Web Lock permits one writable tab, supports explicit takeover, and is backed by transactional stale-revision checks. The sidebar reports origin storage use, quota failures remain visibly unsaved, and idle cleanup removes only assets unreferenced by both current pages and recovery snapshots. A build-generated service worker caches the complete application shell for offline reopening and holds new versions until notebook persistence is safe and the user requests a reload. A deterministic network-free mock lesson now exercises strict semantic proposal validation, local Dagre layout, preview/discard, atomic commit, persistence, and undo/redo before a live provider is connected. Richer text tools, multi-object transforms, performance, and physical-device validation still require implementation.

## Run locally

Requirements: Node.js 24.x and npm 11.x (the versions used for the first spike).

```bash
npm install
npm run dev
```

Vite prints the local URL. The development server is configured for LAN access so physical tablets can be tested on the same network; this does not provide HTTPS or production security.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Current structure

```text
apps/web/src/domain/       Engine-independent notebook records, validation, and history
apps/web/src/fixtures/     Deterministic comparison input
apps/web/src/ai/           Semantic proposal schemas, validation, layout, and atomic batches
apps/web/src/canvas/       Konva rendering and ink/input helpers
apps/web/src/components/   Accessible HTML learning cards
apps/web/src/export/       Document-driven static page export
docs/experiments/          Evidence, limitations, and implementation gates
```

The semantic document is the source of truth. Konva state is a projection of that document, not the notebook file format.
