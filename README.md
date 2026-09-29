# AI Notebook

AI Notebook is a local-first learning notebook. You write, draw and type on an infinite canvas, and ask an AI to teach a short section, explain what you selected, draw a diagram or write a quiz. What the AI produces lands on the page as ordinary, editable objects — text cards, equations, diagram nodes and connectors, multiple-choice questions — not as a chat transcript or a picture.

Notebooks live in your browser. Writing, editing, saving, undo and answering stored quizzes work offline; the AI is used only when you ask for it.

## What it does today

**Writing and drawing**
- Pen with pressure, a separate highlighter, whole-stroke eraser, and **Pen Pro**, which neatens handwriting in place after you pause (baseline, size, slant and spacing) while keeping your own letters.
- Low-latency "wet ink" drawn outside React, a capacitive-stylus wobble filter, palm-rejection and stylus-only touch modes, and two-finger pinch to zoom and pan.
- Text boxes, rectangles, ellipses, images (stored once by content hash), bound connectors, lasso and multi-select, move, resize, group, duplicate and delete, all through one undo/redo history.
- Optional plain, lined or grid paper per page, inside the same infinite canvas.

**Learning objects**
- Editable text cards, LaTeX equations (rendered by KaTeX in untrusted mode), diagrams whose nodes and connectors stay bound when moved, and quizzes with stable option IDs.
- Quizzes are graded on the device. Every answer is kept as an immutable record with the question version, first try versus retry, and whether a hint or the answer was shown. A per-page **Quiz review** lists what is worth another look, without inventing a mastery score.

**AI (optional, through your own DeepSeek account)**
- Four canvas actions — Teach a section, Explain selection, Create diagram, Create quiz — stream a draft you can review, then add to the page as one undoable step. The model's proposal is validated twice (in the gateway and again on the device) and can only *add* content.
- A study-assistant panel answers questions from your uploaded PDFs, Word files and text/Markdown files and from your notebook pages, with citations that open the exact passage. Files are read and searched on the device (keyword search, no embeddings); only the passages matching a question are sent.
- Every AI card shows where it came from (action, model, time, the notes it was based on), is flagged when those notes are edited or deleted, and can be reported as wrong; reports stay on the device.

**Keeping your work**
- Saved to IndexedDB after every change, with an honest saving/saved/error status, one recoverable previous version per page, storage-quota warnings, and one writable tab at a time (others are read-only until they take over).
- `.ainotebook` archives carry every page, image, uploaded source, chat message, quiz answer, AI report and AI provenance, with integrity hashes; importing creates an independent copy. Pages can also be exported as SVG, including off-screen content.
- A service worker caches the app for offline use and applies updates only when your work is saved and you ask for a reload.

## Run it

Requirements: Node.js 24 and npm 11.

```bash
npm install
npm run dev
```

Vite prints the local URL. The development server listens on your network so a tablet can reach it; that is plain HTTP, which some browser features (Web Locks, service workers) only allow on `localhost` or HTTPS.

### AI gateway

AI requests go through a small server in `apps/gateway`, never directly from the browser. By default it uses a deterministic **mock provider**, so everything can be tried without an account:

```bash
npm run dev:gateway
```

Vite proxies `/api` to it on `127.0.0.1:8787`. To use DeepSeek:

1. Copy `apps/gateway/.env.example` to `apps/gateway/.env` (ignored by Git).
2. Set `AI_PROVIDER=deepseek`, your own `DEEPSEEK_API_KEY`, and a random `GATEWAY_ACCESS_TOKEN` of at least 32 characters.
3. Copy `apps/web/.env.example` to `apps/web/.env` and set `VITE_GATEWAY_ACCESS_TOKEN` to the same token. This token only keeps other people on your network off the gateway; it is **not** your DeepSeek key, which must never go in the web app or any `VITE_` variable.
4. Restart the gateway.

The gateway allows one AI request at a time and enforces per-minute, daily-request and daily-token limits; cancelled or failed calls are charged too, using a deliberately high estimate when DeepSeek reported no usage.

### What leaves your device

Nothing, until you run an AI action or ask the study assistant a question. Then the gateway sends DeepSeek the selected notes (or, for a chat question, the matching passages and recent conversation). Quiz answer keys, handwriting ink and images are never sent. DeepSeek's own data-retention terms apply to what it receives.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

The gateway also has a recorded prompt evaluation; see [docs/experiments/prompt-eval/README.md](docs/experiments/prompt-eval/README.md).

## Not yet verified

This is a personal alpha. In particular:

- **No physical tablet or pen testing yet.** Pressure, palm rejection, latency, the wobble filter, Pen Pro and pinch have been exercised with synthetic events in a desktop browser only.
- Performance on the planned 2,000- and 5,000-stroke scenes has not been measured frame by frame.
- AI quality has been measured on 57 recorded prompts (all valid, 96% without repair), but generated quiz answer keys have not had the planned manual review of 50 questions, and retrieval quality has only been smoke-tested.
- Reading handwriting with the AI is not built.

`IMPLEMENTATION_PLAN.md` records every milestone with what was and was not checked; `docs/decisions/` explains each settled choice.

## Guides

- [Self-hosting and using a tablet](docs/guides/self-hosting.md), including HTTPS on your network
- [Backup, restore and moving between devices](docs/guides/backup-and-restore.md)
- [Privacy and data flow](docs/guides/privacy.md)
- [Compatibility](docs/guides/compatibility.md): what has and has not been tested
- [Contributing](CONTRIBUTING.md) and [reporting a security problem](SECURITY.md)

## Layout

```text
apps/web/src/domain/       Notebook records, validation, history, quizzes, paper, staleness
apps/web/src/canvas/       Konva rendering, ink, input, camera and handwriting neatening
apps/web/src/components/   Learning cards, sidebar, dialogs and the study-assistant panel
apps/web/src/ai/           Request context, gateway client, proposal compilation and layout
apps/web/src/sources/      On-device text extraction, passage splitting and keyword retrieval
apps/web/src/persistence/  IndexedDB storage, migrations, archives and the single-writer lock
apps/web/src/export/       Static SVG export from the document
apps/gateway/src/          Gateway, limits, mock and DeepSeek providers, prompt evaluation
packages/ai-contract/src/  Proposal schema, gateway and chat protocols shared by both apps
docs/decisions/            Why each architectural choice was made, with evidence
```

The semantic document is the source of truth; Konva draws a projection of it and is never the file format.
