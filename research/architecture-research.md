# Application architecture and storage research

Research date: 13 September 2026. Scope: the application described in `idea.md`, for personal use first and later open-source release. Confirmed preferences supplied during research: **desktop and tablet from the first version; direct DeepSeek API for AI; no automatic sync initially—local notebooks and export/import are sufficient**. This is a recommendation memo, not an implementation or a benchmark result. Library capabilities below are documented facts; architecture choices and acceptance criteria are engineering recommendations.

## Recommendation

Build a **responsive React + TypeScript + Vite web app with PWA support**, persist notebooks locally through **Dexie/IndexedDB**, and send explicit AI requests through a **small TypeScript gateway to the direct DeepSeek API**. Serve frontend and gateway under one HTTPS origin for use on both desktop and tablet. Keep the canvas engine replaceable at the command/context boundary, while using one authoritative representation of each object. Start with reliable export/import and explicitly separate device support from automatic synchronization.

This is a smaller operating burden than the concept's Next.js + FastAPI + SQLAlchemy + PostgreSQL combination. The notebook is an interactive client application: strokes, selection, layout, local MCQ checking, saving, and undo run on the user's device. The initial server's job is credential protection and bounded AI requests, not rendering the notebook or accepting a network request for each stroke. This recommendation is a fit judgment, not a claim that Next.js or Python cannot support the product.

## Stack decisions

| Area | Recommended first choice | When the alternative becomes worthwhile |
| --- | --- | --- |
| Client | React, TypeScript, Vite | Next.js if public content pages, significant server-rendered UI, or an existing Next codebase materially reduce work |
| Styling | Tailwind if familiar; ordinary CSS is also sufficient | No additional UI framework is required for the canvas |
| Offline shell | A service worker through `vite-plugin-pwa`, caching app code, fonts, and required assets | A native wrapper when file integration or platform input limitations demand it |
| AI gateway | TypeScript on Node; Hono is a small suitable routing option | FastAPI when existing Python code, OCR libraries, document processing, or model hosting actually require Python |
| Notebook persistence | Dexie over IndexedDB in each browser/device | SQLite for a native desktop edition or a single-process sync server; PostgreSQL for a hosted service with more demanding concurrency/operations |
| Validation | Shared TypeScript runtime schemas across client and gateway | Pydantic/OpenAPI generated client if a Python service is introduced |
| Cross-device movement | Versioned notebook archive export/import | Revision-based synchronization when automatic handoff becomes essential; CRDTs when concurrent editing is a requirement |

Next.js supports static exports, but server-dependent features—including request-dependent route handlers, cookies, and server actions—are not part of a static export. Exporting a Next app therefore does not package a secret-holding AI backend into a static site. [Next.js static export documentation](https://nextjs.org/docs/app/guides/static-exports)

Hono documents a Node adapter, so a small gateway can share language and validation code with the client. The PWA plugin provides service-worker and manifest integration with Vite. Use these as plumbing, not a reason to introduce a complex monorepo or service fleet. [Hono Node guide](https://hono.dev/docs/getting-started/nodejs), [Vite PWA guide](https://vite-pwa-org.netlify.app/guide/)

Suggested initial repository boundaries are `web/`, `server/`, and `shared/` in one repository and one lockfile. `shared/` contains the versioned AI action schemas and request/response types. Extract more packages only when a real reuse boundary appears.

## Desktop, tablet, offline, and deployment

Use the same web application and data format on desktop and tablet, with responsive controls and input tested on real hardware. Test the actual intended tablet/pen combination early; a desktop browser's touch emulation does not establish Apple Pencil, S Pen, palm rejection, pressure, or long handwriting-session quality.

Service workers require a secure context: HTTPS normally, with a localhost development exception. Loading an HTTP development server at a laptop's LAN IP on a tablet is not equivalent to localhost. Also, `localhost` in the tablet's browser refers to the tablet, not the laptop. [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

Recommended deployment shape:

```text
Desktop browser/PWA                  Tablet browser/PWA
  local notebook DB                    local notebook DB
             \                         /
                HTTPS app origin
           static app + authenticated /api
                         |
                  TypeScript gateway
                  server-held API key
                         |
                  Direct DeepSeek API
```

For personal use, run a small Node service behind HTTPS, on a private server or another protected always-available host. The gateway is stateless with respect to notebooks: persist no notebook database on the server; keep only the minimal authentication/session state needed to protect access. A container and reverse proxy are a reasonable reproducible distribution. A serverless gateway is also viable, but verify its streaming and timeout limits before choosing it. Do not expose the gateway publicly without access protection: possession of the URL must not let strangers spend the configured API allowance.

An optional local development mode can bind the gateway to loopback and keep the key in the server's ignored environment file. For laptop-to-tablet development, deliberately configure a trusted HTTPS endpoint and authentication rather than assuming a wildcard CORS setting makes a LAN deployment safe. Same-origin production deployment removes most cross-origin setup. If origins differ, allowlist exact origins and apply proper request/session protection; CORS alone is not authorization or CSRF protection. [OWASP HTML5 security guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)

The offline contract should be precise: after initial loading/caching, creating and opening local notebooks, handwriting, selection, saving, quiz answering, and archive export continue without the AI service. AI actions show that they require a connection and allow explicit retry. Do not silently queue paid requests and send them hours later. A service worker caches application resources; IndexedDB stores notebook data. These are separate responsibilities. [MDN offline operation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

Stage PWA updates until pending strokes and edits have committed, then offer a safe reload. Do not automatically reload the editor when a new service worker activates. Test an update during a writing session and ensure an old cached application cannot keep writing against an incompatible migrated database.

Keep the production origin stable: changing hostname, scheme, browser profile, or port can leave the user viewing a different browser storage namespace. Browser and installed-PWA behavior must be tested; never promise that every installation mode shares one data store. [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

## DeepSeek credentials and privacy boundary

The direct DeepSeek API uses bearer authentication, and its quickstart documents `https://api.deepseek.com` as the base URL and `/chat/completions` as the chat endpoint. “Direct” means the gateway calls DeepSeek itself; it does not require exposing the key to the browser or adding an inference reseller. [DeepSeek authentication reference](https://api-docs.deepseek.com/api/deepseek-api/), [DeepSeek API quickstart](https://api-docs.deepseek.com/)

DeepSeek's Open Platform Terms, effective 29 April 2026, explicitly require keeping the API key secure and prohibit exposing it in browser or other client-side code (§2.2). Store the personal `DEEPSEEK_API_KEY` on the gateway; exclude it from frontend environment variables, HTML, JavaScript bundles, notebook exports, screenshots, analytics, and request logs. [DeepSeek Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)

Vite substitutes `VITE_*` values into client code and specifically warns against putting API secrets there. An ignored frontend `.env` file does not make such a value private after bundling. [Vite environment-variable documentation](https://vite.dev/guide/env-and-mode)

For the open-source edition, define BYOK as **each self-hosted installation supplies its own server-side key**. A public demo should use mock responses or a tightly constrained authenticated demo budget. Do not add browser-only DeepSeek BYOK: keeping the key only in memory avoids persistence but still exposes it to client-side JavaScript, which conflicts with the cited API-key requirement. localStorage/IndexedDB are not an OS credential vault.

The gateway should accept an intent plus bounded selected context, validate it, enforce maximum payload/output size, apply a request timeout and cancellation, and call the configured DeepSeek endpoint. Avoid a generic arbitrary-URL proxy. Redact credentials and notebook content from operational logs by default. The application remains locally stored, but selected content sent to DeepSeek leaves the device; the UI should make that boundary visible at the action/context preview.

Check the actual API account's terms and data handling before documenting retention or training guarantees. The Open Platform Terms (§5.5) and Privacy Policy introduction distinguish downstream application end-user data processing from the consumer policy; they do not establish a blanket zero-retention or no-training guarantee for this application. A later public service needs its own clear data-processing disclosure. API use does not require distributing or self-hosting model weights. [DeepSeek Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)

## Data durability and one source of truth

Use Dexie transactions to persist an operation's related records together and Dexie version upgrades for database migrations. Do not hold an IndexedDB transaction open while awaiting an AI network response: validate and prepare the result, then commit local data in a short transaction. [Dexie transaction API](https://dexie.org/docs/Transaction/Transaction), [Dexie version upgrades](https://dexie.org/docs/Version/Version.upgrade%28%29)

Recommended ownership rules:

1. One canonical scene holds the editable page state. If the chosen canvas SDK owns scene records, persist its supported snapshot and put semantic content in supported custom properties/records. If the engine is lower-level, the application's typed scene document is canonical and the renderer derives from it.
2. Do not simultaneously maintain a native scene, a separate mutable `CanvasObject` table, and an independent `Stroke` table containing copies of the same geometry. Parallel writers lead to broken selection, undo, migration, and AI context.
3. `Notebook` and `Page` metadata describe the collection, page order, title, and page type. A page points to its scene. Assets live once in an asset store, referenced by stable asset IDs; do not repeat image base64 in every snapshot.
4. Quiz attempts and review history are separate append-only learning records referencing stable question/concept IDs. Mastery displays are derived summaries, not a second source for question content or canvas geometry.
5. Selection, camera, hover state, active tool, streaming previews, and pending proposals are session/UI state, not learning content. Decide explicitly which preferences to restore.
6. An AI request captures relevant IDs and a page/object revision. When it finishes, check that targets still exist and have compatible revisions. Store a validated batch as one undoable command and one persisted revision. A delayed response must not overwrite intervening handwriting or move a different object that reused an ID.

The persistence envelope should include at least application format version, canvas engine identity and engine schema version, document ID, revision, scene payload, asset manifest, and timestamps. Keep golden fixtures for old formats and test their migration. Refuse unsupported future formats safely while retaining the original file. The AI command schema and saved-document schema need separate versions because they change for different reasons.

Autosave should follow completed strokes and discrete edits, with short batching where needed; it must not serialize the entire notebook at pointer-event frequency. Show “saved” only after the persistence transaction commits. Measure large-page writes and rendering stalls before deciding whether chunked scene records or a worker are necessary. Save continuously: browser suspension and forced termination make unload-only saves unreliable as a product design.

Use a **single writable tab per notebook** initially, with other tabs read-only until ownership is transferred. Enforce ownership/revision checks in the persistence layer so an old tab cannot resume and overwrite newer changes. No cross-device sync does not eliminate this same-device concurrency risk. Test opening the same notebook twice, closing or suspending the owner, and reopening after a schema update.

Browser storage is best effort unless persistence is granted; grant behavior varies, and users can still erase data. Request `navigator.storage.persist()`, inspect `persisted()`/`estimate()`, handle quota failures, and display actionable save errors. WebKit documents heuristic persistence decisions and origin-level eviction. Persistent storage is useful, but it is not a backup. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)

Backup/restore belongs in the first usable release. Provide a documented archive containing a manifest, versioned page JSON, assets, immutable quiz attempts, review history, and AI/source provenance; exclude keys and ephemeral caches. Rebuild derived mastery summaries from the preserved evidence. Import into a new notebook by default, preserve or consistently remap all question/concept/source references, validate archive limits, and report missing assets. Round-trip tests must compare learning history as well as visible page content. Keep several local recovery checkpoints, but label them separately from an exported backup: a cleared browser profile removes both live data and local checkpoints.

For a later SQLite edition, use the database backup API or an equivalent coordinated snapshot rather than casually copying an actively written database file. SQLite documents desktop application-file use and an online backup API. [SQLite appropriate uses](https://sqlite.org/whentouse.html), [SQLite backup API](https://www.sqlite.org/backup.html)

## Synchronization: separate scope, explicit conflicts

“Runs on desktop and tablet” does not automatically mean “my notebook follows me between devices.” The user confirmed the initial promise: each device has local notebooks, and export/import transfers them. Automatic synchronization is deferred. The following alternatives are future design options, not first-release work.

For one person using one device at a time, start with authenticated snapshot synchronization: immutable revision IDs, conditional updates against the last known server revision, content-hashed assets, tombstones for deletion, an outbox, and visible sync status. A stale write creates a conflict copy or a user-visible comparison; never silently replace a newer notebook using last-write-wins timestamps. Offline operation remains local and uploads resume on foreground reconnect. Sync and backup still have different jobs because deletion/corruption can sync too.

A personal server can use SQLite behind its API with an asset directory; a managed multi-user service may justify PostgreSQL/object storage. SQLite's documented single-writer behavior is usually compatible with a small personal service, whereas many concurrent writers or multiple application servers change the decision. Do not share an active SQLite file directly through a network drive or file-sync folder as a collaboration strategy. [SQLite appropriate uses](https://sqlite.org/whentouse.html)

Add Yjs or the chosen canvas SDK's supported collaboration layer when simultaneous offline/concurrent edits become a requirement. Yjs offers IndexedDB persistence and network-provider composition, but its existence does not solve application permissions, asset transfer, quota handling, schema migration, semantic conflicts, or undo policy automatically. Adopt one synchronization model that fits the engine; layering an unrelated CRDT over a second mutable scene is risky. [Yjs offline documentation](https://docs.yjs.dev/getting-started/allowing-offline-editing)

## Native desktop and local models later

Do not begin with both a desktop wrapper and a PWA build. A desktop wrapper alone does not satisfy tablet support and creates another input/runtime surface to validate.

Tauri is a viable later wrapper for the existing frontend, with a SQLite plugin and platform capability controls. It also introduces Rust and platform build/signing work. Its system-webview model means rendering/input must be validated per platform. Stronghold is an available encrypted secret-storage plugin, but a complete unlock/key-management design is still needed. [Tauri introduction](https://v2.tauri.app/start/), [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/), [Tauri Stronghold plugin](https://v2.tauri.app/plugin/stronghold/)

Electron is a reasonable desktop alternative if a consistent bundled browser runtime and Node integration are worth its distribution footprint. Isolate renderers, sandbox untrusted content, and expose narrow IPC methods; generated notes must never acquire arbitrary Node access. It is not the tablet distribution plan. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

A future local-model adapter can route the same validated requests to a local runtime. Ollama documents its loopback bind and origin configuration; a tablet still needs a reachable, protected model host. Local inference on the laptop is not on-device inference on the tablet, and an offline tablet cannot call an unreachable laptop. Keep local-model support capability-driven: model quality, structured output, vision, context size, and hardware memory vary. [Ollama FAQ](https://docs.ollama.com/faq)

## Imports and open-source release

Start with app-native archive import/export and optional PNG/PDF export. Later, PDF.js can render imported PDFs in the browser. Keep the original PDF plus page references, render pages on demand, and preserve annotations in the notebook's own scene. Do not convert an entire large PDF into permanent full-resolution page bitmaps at import time. Selectable text extraction and scanned-page OCR are separate tasks; PDF import does not imply handwriting recognition or reliable textbook reading. [Mozilla PDF.js getting started](https://mozilla.github.io/pdf.js/getting_started/)

For course-grounded AI later, retain document ID, page number, and excerpt provenance alongside retrieved chunks. Begin with selected-page context or lexical search before operating a vector database. Add a Python worker only when a chosen OCR/document library requires it; it need not replace the main gateway.

Prefer a permissive application license such as MIT for broad personal forks, or Apache-2.0 if an explicit patent grant is a priority. These are project-owner choices, and all bundled dependency/assets/model licenses must be checked independently. A public repository without a license is not a complete open-source release; publishing application code does not remove restrictions of a canvas SDK dependency. [MIT license text](https://choosealicense.com/licenses/mit/), [Apache-2.0 license text](https://opensource.org/license/apache-2.0)

Prepare a lockfile, documented runtime versions, `.env.example` with placeholders, a mock-AI demo requiring no account, sample notebooks containing no private material, a versioned archive specification, migration fixtures, and setup/backup instructions. Use a locked CI installation; `npm ci` requires a lockfile and fails when package metadata and lockfile disagree. [npm ci documentation](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

## Acceptance gates before trusting personal notes

- A desktop and a real target tablet both complete writing, selection, erasing, undo, object editing, and save/reopen without AI access.
- After the app has been loaded once, an offline reload opens a saved notebook, permits edits, and preserves them on a later reopen.
- Forced close/reopen, low-storage errors, multi-tab editing, and a schema upgrade do not silently discard confirmed-saved notes.
- Export from desktop and import on tablet reconstructs strokes, diagrams, quiz definitions/attempts, review history, AI/source provenance, page order, and asset references.
- A DeepSeek response arriving after the selected object was edited/deleted is handled safely; a retry cannot duplicate the entire lesson.
- A service-worker update does not force a reload in the middle of a stroke or before pending edits have been persisted.
- A distributed client build and notebook export contain no configured DeepSeek key; unauthenticated gateway calls are rejected.
- If sync is included, two offline devices editing the same page produce an explicit conflict outcome instead of a silent overwrite.

The two-week schedule in `idea.md` is suitable for a narrow interaction prototype. Durability, real tablet input quality, secure shared AI access, and a dependable release should be treated as measured milestones rather than assumed consequences of that prototype.
