# AI Notebook Implementation Plan

## 1. Intended result

Deliver a personal learning notebook that works on desktop and tablet, stores notes locally, transfers complete notebooks through export/import, and uses DeepSeek to create and explain editable content on the canvas. Ordinary writing, saving, and answering stored quizzes must work without AI or network access.

This is a proposed build plan, not work already implemented. Its technical basis and source references are in [RESEARCH_REPORT.md](C:/Users/Ryzen/Desktop/AINotebook/RESEARCH_REPORT.md). The original concept remains in [idea.md](C:/Users/Ryzen/Desktop/AINotebook/idea.md).

Selected baseline: React + TypeScript + Vite, Konva + react-konva + perfect-freehand with React HTML learning cards, Dexie/IndexedDB, a small authenticated TypeScript HTTPS gateway, and DeepSeek. The user selected the Konva hybrid on 2026-09-14 after the initial comparison; Excalidraw was removed.

## 2. Release scope

| Required for personal alpha | After personal alpha |
|---|---|
| Notebook/page creation, rename, reorder, reopen | Automatic device synchronization |
| One pen, highlighter, whole-stroke eraser | Partial eraser and advanced brushes |
| Select/lasso, move, resize, basic groups | Sophisticated selection of part of a stroke |
| Text, basic shapes, bound arrows, image assets | PDF/textbook ingestion and semantic retrieval |
| Pan/zoom, tablet toolbars, keyboard shortcuts | Native desktop/mobile packaging |
| Infinite scene plus optional paper frame | Complex print pagination/reflow |
| Local autosave, recovery, complete archive transfer | Shared notebooks and live collaboration |
| Editable equation, diagram, explanation, and MCQ objects | Voice and continuous AI observation |
| Teach a short section, explain selection, create quiz | Predictive mastery models |
| Local MCQ grading and attempt history | Full flashcard/review scheduler |
| DeepSeek cancellation/errors/limits and atomic undo | General autonomous agent or MCP integration |
| Selected-ink vision probe; ship only if reliable | Dedicated OCR provider or custom OCR training |

Selected typed text and editable diagrams are the initial guaranteed context types. Preserve vector handwriting from the beginning; expose “Explain handwriting” only after the DeepSeek vision path passes its acceptance checks. Do not imply that a text-only endpoint reads raw strokes.

## 3. Work sequence and estimates

Estimates assume one experienced developer working approximately full time, access to the intended test devices, and a limited feature set. They are engineering estimates, not delivery commitments. The likely critical path is **engine decision → reliable notebook → semantic commands → DeepSeek integration → tablet/recovery hardening**.

| Phase | Focused effort | Dependency | Concrete deliverable |
|---|---:|---|---|
| 0 | 4–5 days | None | Engine comparison and DeepSeek capability evidence |
| 1 | 10–15 days | Engine decision | Usable offline notebook and archive format |
| 2 | 5–7 days | Stable command model | Editable learning objects driven by deterministic fixtures |
| 3 | 5–8 days | Phase 2, DeepSeek probe | First real AI learning experience |
| 4 | 5–7 days | Phase 3 | Reliable quizzes, context, and review evidence |
| 5 | 6–10 days | Integrated alpha | Device-tested personal release with recovery/export coverage |
| 6 | 10–15 days | Personal use feedback | Reproducible open-source release |

Phases 0–5 total roughly 35–52 focused working days. With integration contingency, budget **8–12 weeks for personal alpha**, then **2–3 additional weeks for open-source readiness**. A failing canvas experiment or lack of real hardware can extend this. The Konva path retains the custom editor work budgeted below.

### Phase 0 — Resolve the expensive unknowns

**Progress — 2026-09-14:** The first runnable canvas lab is scaffolded under `apps/web`. A shared versioned fixture was rendered through Konva and Excalidraw during the initial comparison. Contract tests, type checking, and a production build passed; browser smoke checks created trial strokes in both candidates and verified local quiz grading in the Konva DOM card. The user then selected the Konva hybrid; Excalidraw code and dependencies were removed, and the decision was recorded in `docs/decisions/0001-konva-hybrid.md`. Physical-device input, Konva navigation/history/persistence/export, performance fixtures, and the DeepSeek capability probe are still outstanding.

**Work**

- Define a small semantic fixture: handwritten equation, highlighter, three-node graph, text card, equation card, and MCQ.
- Retain the completed minimal comparison evidence, then develop only the selected Konva hybrid. Pin versions and record dependency licenses.
- Test pen/touch arbitration, input cancellation, lasso semantics, card activation versus dragging, annotation layering, and text editing.
- Export a page containing every object type; verify that HTML cards are present.
- Save/reopen the fixture; duplicate a connected diagram; undo one mock AI batch while preserving a separate user stroke.
- Probe the chosen DeepSeek account from a backend: basic response, Flash text+image input, non-thinking named tool arguments, strict beta schema support, stable JSON fallback, streaming/keep-alives, cancellation, and truncation. Verify account balance and record actual token usage.
- Record model/endpoint/settings separately from claims in a model card. Use synthetic input for the probe.

**Decision rule**

Decision completed: use the Konva hybrid. If web pen quality fails on target devices, reassess the platform/native-ink approach before adding AI features rather than silently changing engines.

**Exit evidence**

A short decision record contains the exact engine version, supported device/browser/pen combinations, timings, failed interactions, remaining custom work, and verified DeepSeek capabilities. A quick spike is not production certification. No engine choice is justified only by a visually convincing desktop demo.

### Phase 1 — Build a notebook worth keeping notes in

**Progress — 2026-09-14:** The Konva editor now has a shared world-coordinate camera, hand-tool and wheel panning, anchored zoom controls, pressure-preserving pen input with a constant-width mouse fallback, coalesced-sample filtering, animation-frame live rendering, a separate translucent highlighter, semantic whole-stroke erasing, movable graph/card objects, freeform lasso selection, additive object selection, relationship-safe duplication, deletion, and shared document undo/redo. Browser smoke checks verified pen commit/undo/redo, highlighter-over-card layering, erasure, pan, aligned zoom, direct card selection, duplication, deletion, and undo restoration. Nine focused tests pass. Physical pen/touch quality, pinch zoom, resize/grouping, text/shape/arrow/image creation, persistence, and export remain open.

**Progress — 2026-09-15:** A persistent left page sidebar now creates, opens, inline-renames, and safely deletes independent notebook pages. Deletion requires a second inline action, selects the nearest surviving page, and creates a blank replacement when the final page is removed. Page metadata and committed canvas objects are stored in IndexedDB through Dexie with serialized per-page writes and an honest saving/saved/error indicator. Browser checks verified page isolation, restoration of page entries and titles after reload, and the non-destructive delete-confirmation state. Twelve focused tests pass. Recovery snapshots, schema migrations, storage-capacity handling, and one-writer tab coordination remain open.

**Progress — 2026-09-15 (object authoring):** Users can now insert editable text notes and draw rectangle or ellipse objects by selecting a toolbar tool and dragging the desired bounds in any direction. A dashed transient preview becomes one selected, undoable object on pointer release; cancellation and tiny accidental taps commit nothing. Users can move and resize both React cards and Konva objects, and create a bound connector when exactly two graph/shape objects are selected. Insert, edit, resize, and connect each commit through shared history as one persistent document update. Browser checks verified note insertion/editing and restoration after reload plus a custom-sized rectangle drag/commit. Fourteen focused tests pass, including normalized reverse-direction shape geometry. Image insertion, richer text formatting, connector anchor selection, grouping, and physical touch/stylus resize validation remain open.

**Progress — 2026-09-15 (recovery and migrations):** IndexedDB schema version 2 adds one recoverable prior snapshot per page. Page overwrites and snapshot creation are atomic, deletion removes both records, and an explicit sidebar action swaps the saved page with its previous version so recovery can itself be reversed. Stored pages now pass through a tested migration boundary that upgrades pre-versioned records, supplies missing object revisions, and rejects document schemas newer than the application understands. Eighteen focused tests, type checking, and a production build pass. Browser verification of the database upgrade and recovery control, storage-capacity handling, and one-writer tab coordination remain open.

**Progress — 2026-09-15 (canvas viewport controls):** Canvas wheel handling now uses a non-passive native listener at the viewport boundary. A plain wheel pans only the canvas camera, while Ctrl/Command+wheel prevents browser zoom and performs clamped, pointer-anchored canvas zoom. The toolbar adds an accessible full-screen toggle using the browser Fullscreen API, with a viewport-filling fallback and Escape handling where element fullscreen is unavailable. Camera math has focused coverage; twenty-two tests, type checking, and a production build pass. Physical mouse/trackpad and browser fullscreen smoke checks remain open.

**Progress — 2026-09-15 (grouping):** Mixed learning objects can now be grouped and ungrouped through atomic document commands. Selecting one member expands to the complete group; dragging a member translates every grouped card, shape, node, and ink stroke while semantic connectors redraw from their endpoints. Bound connectors are included automatically, and duplicated groups receive fresh group identities rather than remaining attached to the originals. Browser checks verified Shift selection, group expansion from one React-card member, and ungrouping. Seventeen focused tests pass. Multi-object scaling/rotation and nested groups remain intentionally unsupported.

**Progress — 2026-09-15 (images):** PNG, JPEG, WebP, and GIF files up to 12 MB can now be inserted as semantic image objects. The browser hashes and durably stores each Blob in a separate IndexedDB asset table before committing lightweight page metadata, so duplicates reuse the same content-addressed binary. Images render in Konva with loading/missing states and support selection, movement, resizing, grouping, connector binding, duplication, lasso, persistence, and a screen-reader text representation. Invalid asset hashes are rejected by document validation. Eighteen focused tests pass. A real file-import round trip, asset integrity revalidation, orphan cleanup, archive inclusion, and static export remain open.

**Progress — 2026-09-15 (archive transfer):** The sidebar now exports every saved page and referenced binary asset to a versioned `.ainotebook` ZIP and imports validated archives as independent copies. Page JSON and assets carry SHA-256 integrity metadata; import enforces compressed/decompressed, entry, page, object, and asset limits, rejects corrupt ZIP data, unsafe paths, unknown fields, invalid relationships, missing or unreferenced assets, and unsupported archive/document versions before mutation. Imported page, object, group, connector, and quiz-option identities are consistently remapped, with collision avoidance against existing page IDs, then pages and assets are committed in one IndexedDB transaction. Browser verification confirmed a real archive download, and 33 focused tests plus type checking and a production build pass. A real browser file-picker re-import and desktop-to-tablet semantic comparison remain open, along with one-writer coordination, storage-capacity handling, orphan cleanup, shell caching, and static export.

**Progress — 2026-09-15 (single-writer coordination):** An origin-scoped exclusive Web Lock now permits one writable notebook tab. Additional tabs load read-only with mutation controls disabled while preserving page navigation, selection, pan, zoom, quiz interaction, and export. An explicit takeover preempts the prior holder and reloads current IndexedDB content before enabling edits; the displaced tab immediately becomes read-only. Page overwrite, deletion, and recovery transactions also compare an expected monotonic `updatedAt` revision, reject stale writes, stop editing, and reload stored data, so lock preemption cannot silently overwrite newer work. Browsers without Web Locks fail closed to read-only. A two-tab browser check verified ownership, read-only controls, and takeover in both directions; 40 focused tests, type checking, and a production build pass. The decision and secure-context limitation are recorded in `docs/decisions/0002-single-writer-web-lock.md`. Crash/reopen takeover on physical tablet browsers remains unverified.

**Progress — 2026-09-15 (storage resilience and asset cleanup):** The sidebar now reports available origin storage usage and shows a persistent, actionable error when IndexedDB reports quota exhaustion or another storage failure; failed changes never transition to “Saved.” Image insertion distinguishes a full-storage failure before committing document metadata. Content-hashed blobs are reclaimed after writer startup and after 1.5 seconds of save inactivity, but only when no current page or reversible recovery snapshot references them; starting another save cancels pending cleanup so an unsaved image cannot be collected. Deleting the final page and inserting its blank replacement now occur in one IndexedDB transaction, eliminating the prior gap where one operation could succeed and the other fail. Pure cleanup and storage-error tests plus the full suite pass (45 tests), as do type checking and a production build; a browser check verified the storage summary and produced no console errors. Actual quota exhaustion and measured cleanup of large real assets remain unverified.

**Progress — 2026-09-15 (offline shell and safe updates):** Production builds now emit a versioned service worker whose cache identity covers the exact contents of the generated HTML, JavaScript, CSS, fonts, and other build assets. The worker precaches that shell, serves same-origin assets cache-first, falls back to the cached application entry when navigation is offline, and keeps a replacement worker waiting. The UI reports browser online/offline state and offers an explicit “Update and reload” action only after notebook persistence reaches “Saved”; saving and failed-save states block activation and trigger a before-unload warning. Browser verification loaded the full persisted notebook after the preview server was stopped, then detected, displayed, activated, and reloaded a second production build without losing page data. Forty-seven focused tests, type checking, and production builds pass. A service-worker update during an intentionally interrupted or quota-failed save and installed-tablet offline behavior remain unverified.

**Progress — 2026-09-15 (static page export):** The active page can now be exported as a self-contained SVG generated from the authoritative document rather than the visible viewport. Export bounds include the nominal page plus negative or off-page content; connectors, shapes, graph nodes, text/equation/quiz cards, highlighter and pen ink, and content-hashed images are rendered in document layer order. Binary images are embedded as data URLs and a missing referenced asset fails clearly instead of producing an incomplete export. Static-export coverage brings the focused suite to 51 tests. A browser check verified that static export remains available in read-only mode, reaches its success status, and produces no console errors. Inspection of the downloaded file and cross-viewer SVG compatibility remain unverified because the test browser did not expose its programmatic download event.

**Work**

- Set up the frontend, local database, schema package, formatter/type checks, and minimal tests.
- Implement notebook/page navigation and one scene model for infinite and bounded-paper modes.
- Implement the agreed pen/highlighter/eraser, selection, move/resize, text, shapes, arrows, and image-asset behaviors.
- Create a command bus with one undo boundary per completed stroke or user operation; temporary pen/camera state stays out of the portable document.
- Add local transactions, autosave status, schema migrations, a recoverable prior snapshot, and storage-capacity errors.
- Enforce one writable tab per notebook initially, with a clear takeover/recovery flow. Do not permit competing whole-page autosaves.
- Build `.ainotebook` archive export/import with manifest, page/object data, assets, hashes, and schema version.
- Cache the application shell for offline use. Service-worker updates must wait for saved edits and a safe reload.

**Exit evidence**

Write and edit for 30 minutes offline, close the application, and restore committed content. Export on desktop and import on tablet with matching semantics, assets, and connector bindings. Repeat with corrupted input and storage exhaustion. A failed save must never display “Saved.”

### Phase 2 — Build the canvas tool system without a live model

**Work**

- Define versioned tagged schemas for text, equation, diagram, and quiz payloads.
- Define semantic insert operations and a restricted update proposal; keep filesystem/network/executable code out of the model command surface.
- Implement `validate`, `measure`, `render`, `toPlainText`, `toExport`, and `migrate` for each learning-object type.
- Add equation rendering and safe Markdown/text display, including overflow and invalid-input handling.
- Build deterministic lesson templates and graph layout, with stable endpoint IDs and rerouting on node moves.
- Implement mixed selection and shared history for ink plus learning objects.
- Add the draft-to-commit path, transaction IDs, inverse operations, target permissions, and object-version checks.
- Feed fixture JSON through precisely the same path planned for real DeepSeek output.

**Exit evidence**

A fixture lesson creates editable objects, remains correct after moving nodes, and round-trips through an archive. One AI transaction can be undone without removing handwriting committed during a simulated slow request. Invalid operations change nothing.

### Phase 3 — Connect DeepSeek

**Work**

- Add a same-origin HTTPS gateway with server-side DeepSeek credentials and private access/session handling.
- Add one `DeepSeekProvider` implementation and a deterministic mock provider. Keep endpoint/model/settings configurable on the trusted server side.
- Start with `deepseek-flash` and explicitly disable thinking for routine structured proposals. Compare thinking-enabled Flash or text-only `deepseek-v4-pro` for harder explanations only if evaluation justifies it. Do not use legacy model names from older tutorials or route image requests to Pro.
- Implement request-context capture: selected text, LaTeX, graph structure, bounded neighbors, and optional selected-ink image.
- Add “Teach one section,” “Explain selection,” “Create diagram,” and “Create quiz.” Keep generated sections short enough to use immediately.
- Test one named `propose_canvas_patch` function through DeepSeek's strict beta endpoint with thinking disabled; forced tool choice is incompatible with thinking mode. Retain a stable JSON Output fallback. Enforce full application limits locally, allow at most one schema-repair attempt, and leave failed proposals uncommitted.
- Reconstruct streamed tool arguments; keep reasoning fields separate from the final payload; detect empty, refused, incomplete, and timed-out responses.
- Enforce one in-flight request per gateway/account initially, with a bounded queue and cancellation. Multiple browser tabs must not bypass limits.
- Record redacted usage metadata, latency, model/configuration, and failure categories; count retries.

**Exit evidence**

Run a recorded prompt set containing short explanations, equations, graphs, quizzes, and malformed/adversarial cases. No provider failure corrupts a page. Opening another page does not redirect a late response. Unrelated handwriting is preserved, while explanations of edited source content are flagged stale rather than silently re-anchored.

### Phase 4 — Make the learning behavior dependable

**Work**

- Check generated MCQ answer keys structurally; review answer correctness and distractor quality separately.
- Grade stored MCQs locally with stable choice IDs and immutable attempt records. Distinguish first attempt, retries, hints, and solution reveals.
- Show evidence-based review states with counts and recency; avoid unsupported mastery percentages.
- Add a section outline, short worked examples, optional hints, and follow-up practice while preserving writing space.
- Test selected handwriting crops using real writing samples. Store editable interpretations linked to source revisions; never replace original strokes automatically.
- Add explicit source/provenance links and a way to correct or report a bad generated explanation.
- Extend archives to cover attempts, learning history, and source/AI provenance, with consistent ID mapping when importing copies.

**Exit evidence**

Manually inspect at least 50 generated MCQs for ambiguity, answer correctness, and explanation consistency. Capture recurring errors as regression fixtures. Answering an existing quiz and updating its attempt record triggers no DeepSeek request. Handwriting assistance ships only for tested capabilities and exposes transcription uncertainty.

### Phase 5 — Personal alpha hardening

**Work**

- Finish static image/print export from the document model, including off-screen content, equations, cards, and ink.
- Test physical desktop/tablet interactions, screen rotation, virtual keyboard, browser background/resume, and installed-PWA behavior.
- Profile normal and stress scenes; fix full-document rerenders, repeated stroke recomputation, and unbounded memory growth where observed.
- Exercise migrations, simultaneous tabs, import collisions, interrupted saves, service-worker updates, missing assets, and model/network failures.
- Add a linear reading view, keyboard access, focus management, and suitable touch targets.
- Use the application for several genuine study sessions and record friction rather than adding unrelated features.

**Exit evidence**

The release passes the acceptance matrix below, has no known data-loss defect, and documents exact supported devices and limitations. Publish a personal-alpha release artifact only after backup/restore works. DeepSeek daily-use access must match the account/service terms.

### Phase 6 — Open-source release

**Work**

- Choose and apply the license for original code after reviewing the exact shipped dependency licenses and notices.
- Write setup, model configuration, tablet HTTPS access, privacy/data-flow, backup/restore, troubleshooting, and migration instructions.
- Provide a reproducible gateway/container setup, environment example with placeholders, locked dependencies, and mock mode requiring no AI account.
- Add an original sample notebook, contribution guide, issue templates, architecture decisions, compatibility table, and a security-reporting route.
- Ensure CI runs with mock inference; live evaluation is an explicit, bounded job using its own secrets.
- Scan release files/history for credentials and personal notebooks; verify a clean machine can build and restore a sample notebook.

**Exit evidence**

A new contributor can clone, install, run without credentials, create notes, import the sample, and configure their own DeepSeek endpoint/key using the documentation. Publishing the source does not include a shared inference service or shared key.

## 4. Suggested repository boundaries

These are proposed paths for later implementation; they have not been created as application code.

```text
apps/
  web/                    React shell, notebook UI, local persistence
  gateway/                Authenticated DeepSeek requests and usage limits
packages/
  document/               Object schemas, migrations, IDs, provenance
  commands/               Validation, transactions, history, permissions
  canvas/                 One selected renderer and input controller
  learning/               Quiz behavior, attempts, review evidence
  ai/                     Context builder, proposal schema, provider contract
  export/                 Archives, static renderer, import validation
tests/
  fixtures/               Original scenes, synthetic AI replies, old schemas
  integration/            Cross-module persistence and command behavior
  e2e/                    Browser workflows
docs/
  decisions/              Engine and model decisions with evidence
```

Keep these as logical modules first; not every folder needs an independently published package. Avoid a plugin framework until a second genuine extension needs one.

## 5. Minimal API and command contracts

Notebook CRUD is local in the first release. The server does not need the notebook/object REST endpoints proposed in `idea.md` until synchronization or server storage is added.

| Proposed endpoint | Purpose |
|---|---|
| `GET /api/health` | Gateway availability without exposing secrets |
| `GET /api/ai/capabilities` | Tested actions/model capabilities visible to the current user |
| `POST /api/ai/generate` | A bounded intent, exact context, limits, and request ID; returns validated draft events |
| `POST /api/ai/cancel` | Stop/mark the current request, if needed beyond aborting the stream |
| Session endpoints | Private gateway access; exact shape depends on the chosen auth mechanism |

Use streamed events such as `started`, `progress`, `proposal`, `usage`, `complete`, and `error`. Partial JSON tokens are not document commands. Only a complete validated proposal can reach the local command executor. If provider-side cancellation cannot be confirmed, mark the local request cancelled and ignore subsequent results; do not claim it guarantees no further provider usage.

The trusted request envelope contains `requestId`, `pageId`, source object IDs/revisions/hashes, permitted operations, target IDs, and output limits. The model returns semantic content with local references. The application allocates persistent IDs and performs all authorization checks.

## 6. Verification matrix

Numerical targets are provisional acceptance goals. Record observations and revised targets explicitly after the initial spike.

| Test group | Required checks |
|---|---|
| Domain/schema | Missing/extra fields, invalid references, duplicate IDs, bad quiz keys, excessive payloads, future schema versions |
| Commands/history | Apply/undo/redo, duplicate response, group duplication, connector repair, stale target, AI plus intervening user stroke |
| Persistence | Archive round-trip including attempts/provenance, prior schema migration, full storage, interrupted commit, missing asset |
| Tabs/updates | Second-tab write prevention; safe takeover after crash; service-worker update during writing; cached-version/database mismatch |
| AI transport | Authentication/balance errors, 429, timeout, 5xx, keep-alives, truncation, empty JSON, malformed arguments, refused/aborted response, duplicate result, cancel, thinking/forced-tool incompatibility |
| AI quality | At least 50 representative prompts; target 95% valid proposals within one repair; separate manual correctness rubric |
| Learning | At least 50 MCQs reviewed; option reshuffling preserves correct IDs; repeated attempts do not masquerade as independent evidence |
| Context/privacy | Selection-only crop, text reused without OCR, bounded neighbors, no notebook/key content in routine logs |
| Device | Pen, finger pan/pinch, palm contact, eraser fallback, lasso, card focus, virtual keyboard, rotation, background/resume |
| Performance | Normal fixture: 2,000 strokes + 100 mixed learning objects; target near-60 Hz navigation on a 60 Hz device and record p95/stalls; separate 5,000-stroke stress result |
| Offline | Cached app starts, saved notes reopen, input/save/undo/local MCQs work; AI is unavailable offline and requires explicit retry after reconnecting |
| Export/accessibility | Off-screen content included; HTML/equations not blank; keyboard card controls and linear reading view usable |

Use unit tests for invariants and contract behavior, integration tests for state boundaries, browser automation for common flows, and physical hardware for pen behavior. Browser emulation cannot establish pressure quality or palm rejection. Avoid testing every CSS adjustment or merely duplicating the implementation in test assertions.

## 7. Risks and decision triggers

| Risk | Early signal | Response |
|---|---|---|
| Editor effort dominates | Konva camera/selection/history/export glue exceeds the planned scope | Narrow scope or reassess the platform boundary explicitly |
| Tablet writing feels poor | Repeated accidental ink, lost samples, unusable touch mode | Resolve input first; evaluate native ink if browser limits persist |
| AI proposal reliability is low | Frequent repairs or wrong relationships | Simplify schema/section size, test another DeepSeek model, retain local validator |
| Generated teaching is misleading | Wrong MCQ keys, unsupported certainty, poor diagrams | Evaluate content, preserve corrections/provenance, ship fewer trusted workflows |
| Data loss/transfer gaps | Archive restores appearance but loses attempts/assets | Make semantic round-trip a release blocker |
| API access or cost changes | Insufficient balance, model changes, or longer-than-budgeted outputs | Bound requests/output, measure billed tokens, update model configuration; keep offline notebook independent |
| Scope expansion | PDF, voice, sync added before core sessions work | Move to later releases and re-estimate explicitly |

## 8. The first ten working days

This schedule creates evidence and a vertical slice. It does not promise the full personal alpha in two weeks.

| Days | Work |
|---|---|
| 1–2 | Define scene/schema fixture; establish the Konva hybrid and pen/card interactions |
| 3–4 | Run physical-device, save/undo/export comparisons; probe DeepSeek capabilities |
| 5 | Confirm the selected engine on physical devices and choose the initial model candidate; record unresolved limitations and revised estimate |
| 6–7 | Establish the selected app shell, document commands, notebook/page navigation, and local saving |
| 8–9 | Implement fixture lesson/diagram/MCQ insertion and correct undo; begin archive round-trip |
| 10 | Demonstrate write → insert lesson → annotate → answer → save/reopen; document remaining work |

If the Konva editor foundation passes quickly, connect a single DeepSeek generation to that slice. If the canvas spike fails, use the remaining days to resolve the failure rather than adding AI to an unreliable surface.
