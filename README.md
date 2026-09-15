# AI Notebook

AI Notebook is a local-first spatial learning notebook for writing, drawing, editing AI-created lessons, and answering quizzes in the same workspace.

The project is currently building on the selected **Konva hybrid** architecture: Konva + react-konva + perfect-freehand for ink and spatial graphics, with accessible React components for learning cards.

The current editor foundation includes a persistent page sidebar with create/open/rename/confirmed-delete actions backed by Dexie/IndexedDB, schema migration and reversible prior-version recovery, a world-coordinate camera with canvas-only Ctrl/Command+wheel zoom and a full-screen mode, pen/highlighter/eraser and navigation tools, editable text notes, drag-to-size shapes, bound connectors, mixed-object grouping, and content-hashed image insertion with separately stored binary assets. Learning objects support movement, resizing, lasso/additive selection, relationship-safe duplication/deletion, and shared undo/redo. Versioned `.ainotebook` archives transfer all pages and referenced assets with integrity validation and import-as-copy ID remapping. An exclusive Web Lock permits one writable tab, supports explicit takeover, and is backed by transactional stale-revision checks. The sidebar reports origin storage use, quota failures remain visibly unsaved, and idle cleanup removes only assets unreferenced by both current pages and recovery snapshots. A build-generated service worker caches the complete application shell for offline reopening and holds new versions until notebook persistence is safe and the user requests a reload. Static export, richer text tools, multi-object transforms, performance, and physical-device validation still require implementation.

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
apps/web/src/canvas/       Konva rendering and ink/input helpers
apps/web/src/components/   Accessible HTML learning cards
docs/experiments/          Evidence, limitations, and implementation gates
```

The semantic document is the source of truth. Konva state is a projection of that document, not the notebook file format.
