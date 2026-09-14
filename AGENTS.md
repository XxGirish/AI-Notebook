# AI Notebook: instructions for Codex

These instructions apply to work in this project. They capture the research and user decisions from September 2026. Follow them when implementing, reviewing, testing, or planning changes. Later explicit user instructions can revise project decisions; record such revisions so future sessions retain them. This file does not override system or developer instructions.

## 1. Start each session with the actual project state

- Read this file and any applicable directory-specific instructions, then inspect the files relevant to the task. Check the working tree when Git is available; preserve unrelated user changes.
- Read the relevant phase of `IMPLEMENTATION_PLAN.md` before implementation. Consult `RESEARCH_REPORT.md` for rationale, alternatives, and cited evidence. Read specialist notes only when needed: `research/canvas-research.md`, `research/ai-research.md`, and `research/architecture-research.md`.
- `idea.md` preserves the original concept. Its earlier technology suggestions are not commitments and must not override the decisions below.
- At this file's creation, the workspace contains research and planning documents, not an implemented application. Inspect the current tree each session instead of assuming this remains true. Never report a proposed feature, benchmark, or API capability as tested functionality.
- Use existing package scripts and the existing package manager once established. Do not invent setup or test commands. Keep installation instructions accurate as implementation develops.
- Proceed with routine work within the user's requested scope. Resolve ordinary implementation details without repeated confirmation. Explain meaningful changes of direction and record the evidence for them.

## 2. Product commitments

Build a personal AI learning notebook that can later be released as open source. The user writes, draws, learns, answers questions, and edits AI-created content in the same spatial workspace.

- Support desktop and tablet from the first usable version. Pen and touch interactions are core requirements, not a later responsive styling pass.
- Use the **direct DeepSeek API**. This supersedes the earlier NVIDIA NIM preference. Keep provider integration isolated, but do not add another provider without a new requirement.
- Store notebooks locally. Initial device transfer is complete export/import; there is **no automatic sync or collaboration**.
- Writing, editing, navigation, saving, undo/redo, and answering stored MCQs must work offline without inference.
- AI runs only for explicit actions such as teaching a short section, explaining selected content, or creating a quiz. Do not continuously send handwriting or notebook activity to an LLM.
- AI output must become editable learning objects on the canvas. A chat sidebar or flattened diagram image alone does not satisfy the product.
- Preserve user-authored ink and content through AI generation, errors, cancellation, undo, reload, migrations, and transfer.

## 3. Scope and build order

Follow the phased plan, completing the necessary foundation before layering features:

1. **Resolve unknowns:** compare canvas approaches on the same fixture; probe DeepSeek capabilities.
2. **Reliable offline notebook:** input, editing, document commands, local storage, recovery, archive transfer.
3. **Semantic learning tools:** editable text/equations/diagrams/MCQs using deterministic mock proposals.
4. **DeepSeek integration:** bounded context, validated generation, cancellation, errors, usage limits.
5. **Learning behavior:** local grading, attempt evidence, source-aware explanations and corrections.
6. **Personal alpha hardening:** real devices, performance, offline updates, export and recovery.
7. **Open-source readiness:** reproducible setup, documentation, licenses, original fixtures, clean distribution.

Initial tools include pen, highlighter, whole-stroke eraser, whole-object lasso/selection, move/resize/group, text, shapes, bound arrows, and images. Use one scene model for infinite canvas and optional bounded paper frames within notebook pages.

Defer automatic sync/CRDTs, multiuser editing, PDF/RAG ingestion, embeddings/vector databases, voice, native wrappers, advanced OCR training, partial-stroke editing, autonomous agents, and predictive mastery until the core is dependable or the user explicitly changes scope. The plan's effort estimates are estimates, not delivery promises.

## 4. Technology baseline and canvas decision

Recommended baseline: **React + TypeScript + Vite**, **Dexie/IndexedDB**, a small **TypeScript HTTPS AI gateway**, shared runtime schemas such as **Zod**, **KaTeX** for equations, and **Dagre** for initial graph layout. Consider ELK only when graph requirements justify it. A lightweight gateway framework such as Hono is sufficient.

Keep document, commands/history, canvas/input, learning, AI/context, persistence/export, and gateway as clear logical modules. Use the proposed repository boundaries in the plan without requiring every module to be a separately published package. Do not add Next.js, a Python service, PostgreSQL, Redis, an agent framework, or a plugin architecture merely because they appeared in the original idea.

**Canvas engine decision (2026-09-14): use Konva + react-konva + perfect-freehand, with React HTML components for interactive learning cards.** The user selected the Konva hybrid after the initial Phase 0 comparison. Excalidraw has been removed from the application and dependency tree. Do not restart the engine comparison or add another production editor without a new explicit requirement.

- Retain one engine. Do not implement a graphics renderer from scratch or maintain multiple production editors.
- Konva is a rendering foundation, not a ready notebook. Camera gestures, selection, bindings, history, accessibility, and export remain application responsibilities.
- Prefer dependencies that permit straightforward open-source redistribution and self-hosting. The research found production/downstream licensing constraints in the current tldraw SDK; do not adopt it under an assumption that it is MIT. Recheck exact-version licenses if reconsidering it.
- Check example-code licenses separately from library licenses, including paid/Pro examples. Pin dependencies and commit the lockfile once the application is scaffolded.

If the Konva hybrid fails actual handwriting quality on target devices, reassess browser versus native ink before expanding AI features. A successful desktop demo is insufficient evidence.

## 5. Canvas and interaction rules

- Store geometry in world coordinates. Camera position, zoom, viewport size, and device pixel ratio must not alter canonical object geometry.
- Use Pointer Events with real pressure when available and a constant-width fallback. Feature-detect coalesced samples. Predicted samples are temporary display data, never saved ink.
- Use explicit interaction modes: select, pen, highlighter, eraser, pan, and edit-card. Pen writes; fingers navigate by default in pen mode. Offer explicit finger drawing.
- Handle pointer capture, cancellation, lost capture, rotation, and background/resume. Provide visible eraser controls and keyboard alternatives; do not depend on a particular pen button or gesture.
- Keep live stroke samples transient and render per frame. A completed stroke becomes one document command. Do not rewrite the entire React document, persist, or call AI on each pointer event.
- Begin with whole-stroke erasing and complete-object lasso semantics. Do not label a compositing demo as correct persistent partial erasing.
- Keep canvas and HTML cards aligned through one camera transform and an explicit layering policy. In pen mode, annotations may cover cards; in interaction mode, card controls must be operable. Specify drag handles and focus behavior.
- Preserve connector references to node IDs/anchors and reroute after movement. Duplication must remap relationships, not leave edges bound to the originals.
- Measure text/card dimensions locally before placement. Preserve manual arrangement; do not globally reflow the notebook after every AI response.
- Provide keyboard-operable learning controls, visible focus, practical touch targets, and a linear reading view. Canvas pixels alone are not accessible content.
- Use viewport culling and cached geometry as justified by measurements. Do not claim native-quality palm rejection or latency without real-device evidence.

## 6. Document ownership, persistence, and export

- Maintain **one authoritative document representation**. Project application records into Konva rather than using stage serialization as the database.
- Do not keep independently editable engine snapshots and application objects as competing sources of truth. A stroke is an object with original samples, pressure, and style; do not duplicate it in a second canonical stroke store.
- Use stable object IDs, revisions, schema versions, groups, and references. Store binary assets separately by content hash rather than repeatedly embedding base64 in page JSON.
- Track generated-content provenance: request, provider/model/configuration, schema, and source IDs/revisions or hashes. Keep quiz attempts separately with their question version.
- Apply mutations through validated document commands with atomic batches and inverse operations. Keep live pointers, network state, and temporary selection outside portable document data.
- Save at command boundaries using transactions. Show success only after the storage commit succeeds. Surface quota/storage errors without falsely displaying "Saved."
- Implement migrations and a recoverable prior snapshot. Browser storage is local to the browser/profile/origin/device and is not a backup guarantee.
- Allow only one writable tab per notebook initially, with takeover and revision checks. Avoid competing whole-page autosaves.
- Cache the application shell for offline use. Activate updates only when edits are saved and reload is safe; handle old cached code against newer database schemas.
- Use a versioned `.ainotebook` archive containing a manifest, document data, assets, integrity hashes, attempts/review evidence, and provenance. Exclude credentials and sensitive operational logs.
- Validate imports before mutation: schema/version, IDs/references, hashes/assets, corruption, compressed and decompressed size limits. Import as a copy by default, consistently remapping IDs. Preserve a backup before an explicitly requested replacement.
- Verify semantic desktop-to-tablet round trips. Imported copies are independent notebooks; export/import does not reconcile divergent edits.
- Implement export from document content across all layers and off-screen bounds. Ordinary canvas capture can omit HTML cards. Equations, quizzes, text, ink, and images must appear in static exports; do not promise vector PDF/SVG merely because ink is stored as points.
- Treat JSON Canvas, if added, as partial interchange rather than the complete lossless notebook format.

## 7. DeepSeek integration and privacy

- Call DeepSeek through the gateway; keep `DEEPSEEK_API_KEY` in ignored server configuration. Never put it in browser bundles, `VITE_` variables, notebook archives, fixtures, committed files, or logs.
- Protect gateway access and enforce request/body/rate/spend limits server-side. Local notebook storage does not require server notebook CRUD or a user-account database.
- Use HTTPS and preferably the same origin for frontend and gateway. On a tablet, `localhost` means the tablet; plain HTTP on a laptop LAN address does not inherit the localhost secure-context exception.
- Isolate model, endpoint, capabilities, and mode in configuration. The September 2026 research recommends `deepseek-flash` as the first text/vision candidate; verify current official DeepSeek documentation and actual account access before integration. Do not silently route image input to a text-only model.
- Research starting point: Chat Completions at `https://api.deepseek.com/chat/completions`; strict function schemas use the documented beta base URL. Reverify API details when implementing instead of copying stale aliases or pricing.
- Prefer one named `propose_canvas_patch` tool with thinking explicitly disabled for routine structured generation, after capability tests pass. The researched API disallows forced/required tool choice with thinking enabled.
- Strict tool schemas are beta and support a subset of JSON Schema. Follow current provider requirements, including required properties and `additionalProperties: false`; enforce omitted length/count constraints in our own validator.
- Stable fallback: JSON Object output with an explicit JSON instruction, followed by the same application validation. Valid JSON does not imply valid or safe document operations. Allow at most one bounded repair; otherwise retain the document and show a recoverable failure.
- Reassemble streamed arguments before validation. Handle terminal status, truncation, empty/malformed output, keep-alives, cancellation, timeout, authentication/balance errors, 429, and 5xx responses.
- Keep reasoning fields out of notebook content and routine logs. If multi-round thinking/tools are later introduced, implement the provider's required conversation-history handling internally.
- Bound input context, output size, retries, time, and cost. Start with one in-flight generation per personal gateway/account, enforced across tabs. Record usage without logging notebook contents or keys.
- Cancellation invalidates the local request and ignores late results. Do not promise that aborting a client stream guarantees zero further provider billing. Offline requests require explicit retry after reconnecting.
- Clearly disclose that selected context is sent to DeepSeek. Do not infer zero retention or no training guarantees without verified applicable API terms.
- Default development and CI to synthetic fixtures/mock responses. Missing live credentials must not block independent offline or schema work. Never ask the user to paste secrets into chat.

## 8. AI canvas tools: required execution contract

Use this pipeline:

`explicit intent -> trusted context envelope -> semantic proposal -> validation -> local layout -> atomic command batch -> persistence`

- The app captures request ID, original page ID, exact source IDs/revisions/hashes, permitted operations, target IDs, and limits. Model output cannot grant itself permissions or choose an unrelated target page.
- Send selected typed text, LaTeX, and graph semantics directly, with bounded relevant parents/neighbors. Do not upload an entire notebook by default.
- For selected handwriting, create an on-demand bounded crop that excludes unrelated content. Preserve vector ink. Link any editable transcription to its source hash; invalidate it when the source changes.
- Ship handwriting interpretation only after the selected model/account passes vision checks. Show uncertainty and permit corrections, especially before grading handwritten math. Model confidence is not calibrated evidence.
- Treat notebook text, imported content, and model responses as untrusted data, not instructions to change tool permissions.
- Model output describes meaning: text blocks, equations, graph nodes/edges, MCQs, and relative anchors. It must not be executable JavaScript/HTML/CSS, raw engine state, shell/SQL commands, or arbitrary low-level drawing instructions.
- Allocate persistent IDs in the app. Validate types, unknown fields, string/object limits, duplicate IDs, references, graph endpoints, quiz answer keys, allowed targets, and operations. Schema validation does not establish factual correctness.
- Produce individual editable diagram nodes and bound connectors through local layout/templates. Store LaTeX source and render it with restricted KaTeX trust settings; successful rendering is not mathematical verification.
- Stream into a draft/progress view. Never mutate the main document from partial JSON. Start with small proposals or lesson sections rather than a general autonomous tool loop.
- Recheck source revisions at commit. Re-anchor after geometry-only movement where safe; changed content requires a stale-draft/regeneration path. Deleted sources must not silently redirect the operation. A late response belongs to its original page.
- Keep the request's idempotency/commit identity separate from transport retries. A duplicate response must never insert the same lesson twice.
- Commit one validated AI action atomically as one undoable batch. Do not hold an open history transaction across a network call or overwrite handwriting created while waiting. Undo must respect subsequent user edits and command dependencies.
- An explicitly requested additive insertion can apply after validation in available space. Destructive replacements need a concrete preview/accept step. Do not add confirmations to every harmless insertion.
- On failure, cancellation, or invalid output, preserve the user's document and offer a clear recovery action.

## 9. Learning behavior

- Generate each MCQ's options, answer key, and rationale together, then grade stored answers locally with zero additional API calls.
- Use stable option IDs and question versions. Shuffling options must not change correctness; preserve the attempt's question version, answer, hint/reveal use, and retry status.
- Treat client-side answers as self-study functionality, not secure examination infrastructure.
- Review generated teaching and answer keys for correctness, ambiguity, and misleading diagrams separately from structural validation.
- Keep transparent evidence such as attempts, recency, first-try correctness, and hint use. Do not invent authoritative mastery percentages or treat retries as independent mastery evidence.
- Explanation requests are not failures. Support short explanations, retrieval practice, hints, and corrections while respecting an explicit request for a full solution.
- Preserve raw attempt history through edits and export. A future scheduler such as FSRS is a separate feature, not a substitute for a validated mastery model.

## 10. Verification and review

Run checks appropriate to changed behavior: type/build/lint scripts when present, focused unit/contract tests, state-boundary integration tests, and browser workflows. Do not add tests that merely mirror implementation or run application tests for prose-only edits.

Release-critical cases include:

- Apply/undo/redo, duplicate AI replies, intervening user ink, stale/deleted sources, node duplication and connector remapping.
- Save/reopen, migrations, interrupted or failed storage, recovery, archive round trips, corrupt imports, missing assets, and second-tab contention.
- Offline startup and editing, safe service-worker updates, explicit AI retry, and cancellation/stream/error handling.
- All-layer export, selected-context privacy, accessible card controls, and real-device pen/touch behavior.

Use the plan's provisional fixtures: a normal scene of 2,000 strokes plus 100 mixed learning objects, and a separate 5,000-stroke stress scene. Record frame-time distribution/stalls and memory; near-60 Hz on a 60 Hz device is a target, not an established result.

Evaluate at least 50 representative AI prompts, targeting 95% valid proposals within one repair, and separately review at least 50 MCQs for content quality before claiming the planned learning acceptance gate. Do not confuse these release evaluations with tests required for every small change.

Test physical desktop/pen hardware, iPad/Pencil Safari, and Android stylus Chrome where available. Browser emulation cannot validate pressure or palm rejection. Record untested combinations and continue independent work; do not claim broad tablet support from one desktop result. Data-loss and incomplete archive restoration defects block a reliable personal release.

## 11. Open-source readiness and continuity

- Keep private notebooks, credentials, and proprietary sample content out of source control and fixtures. Use original or appropriately licensed examples and retain required attribution.
- Document self-hosting and bringing a DeepSeek key to the server. Do not distribute a shared inference key or create an unauthenticated public proxy.
- Before public release, verify the chosen project license and dependency/example compatibility, reproducible install/build, environment examples without secrets, contribution guidance, and known platform limitations.
- When an architectural choice becomes settled, add a concise decision record under `docs/decisions/` with date, exact versions/configuration, evidence, alternatives, and remaining limitations. Update this file if its enduring guidance changes.
- After substantive milestones, update `IMPLEMENTATION_PLAN.md` with completed work, actual validation, blockers, and the next step. Preserve historical research rather than presenting new findings as if they had been tested originally.
- Keep instructions compact: stable rules here, detailed evidence in the research and decision documents. Do not copy the entire research report into agent instructions.
- Finish work with a concise account of what changed, what was checked, and any material unverified behavior. Never claim unrun tests or unresolved milestones are complete.

## Instruction-file maintenance

Keep this file at the project root as `AGENTS.md`. Codex discovers project instruction files at session startup; after changing it, use a new session in this project to load the updated guidance. It is project-scoped, not a global rule for unrelated projects. Keep it below the default 32 KiB combined project-instruction budget, leaving room for more specific instructions.

Loading reference: [OpenAI's AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
