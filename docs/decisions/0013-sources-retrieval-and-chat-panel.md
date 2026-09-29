# 0013 — Uploaded sources, on-device retrieval, and the chat panel

Date: 2026-09-29
Status: accepted. Mock-tested; confirmed against the live DeepSeek API on 2026-09-29 with synthetic files.
Builds on: 0003 (gateway and provider contract), 0011 (canvas AI actions)
Scope change: the user explicitly brought forward "PDF/RAG ingestion", which `AGENTS.md` previously deferred, asking for a NotebookLM-style source upload and a chatbot on the canvas.

## Decision

- **Upload:** PDF (`pdfjs-dist` 6.3.289, Apache-2.0), Word .docx (`mammoth` 1.13.0, BSD-2-Clause), and .txt/.md files are read **in the browser**. Only the extracted text is stored, split into passages of about 1,200 characters (never crossing a PDF page, ~200 characters of overlap), in two new IndexedDB tables (`sources`, `sourceChunks`, database version 5). Both readers load only when a file of that kind is added. The same file (by SHA-256) is not added twice.
- **Retrieval:** keyword (BM25) search with `minisearch` 7.2.0 (MIT) over the passages plus the text of every notebook page — text cards, typed and converted handwriting, equations, quiz prompts and choices (never answer keys or rationales), and diagram labels. It runs on the device and works offline. Up to 12 passages / 24,000 characters per question, at most 6 from one file; a short follow-up borrows the previous question's terms; if fewer than 3 passages match (e.g. "summarise"), the opening passages of each enabled source fill in. Page notes are re-indexed only when a question is asked, by revision, so drawing costs nothing.
- **Chat:** a new gateway route, `POST /api/ai/chat`, streams plain prose over SSE (`deepseek-flash`, thinking disabled, stable endpoint, prompt `chat-prompt-v1`). It shares the canvas actions' limiter: one AI request at a time, same per-minute and daily budgets, same token, same redacted logging. Passages are labelled S1, S2, …; the model cites them as `[S2]`, and the browser shows only labels it actually sent.
- **Panel:** a floating orb (bottom-right) that opens into a 400 px panel on the right (a bottom sheet under 640 px) with Chat and Sources tabs. Escape minimises and returns focus to the orb. Answers render as text with KaTeX (trust off) — never as HTML. History is kept in IndexedDB (`chatMessages`).
- **Add to page:** an answer becomes one editable text card through the existing proposal validation, layout and `applyCanvasBatch` path, as one undoable step (provenance intent `chat_answer`). Citations become numbered references with a "Sources:" list. It is an explicitly requested additive insertion, so there is no second confirmation.

## Why keyword search, not embeddings

DeepSeek's API (checked 2026-09-29) offers chat completions only — no embeddings endpoint. Vector search would need a second provider, which `AGENTS.md` rules out without a new requirement, or an in-browser model (tens of MB to download, slow on tablets, another offline-cache concern). Study material is dense with exact terms (RuBisCO, thylakoid, p = mv) where BM25 does well. `deepseek-flash` has a 1M-token context and is cheap, so sending ~5–10k tokens of passages per question is affordable. A vector index can be added beside MiniSearch later without changing the chat contract, since the browser still sends labelled passages.

## Evidence

- Tests: gateway 110 (7 new: streaming, redacted logging, schema refusals, provider error releasing the slot, token required, request body shape, citation filtering); web 233 (17 new: passage splitting and page boundaries, hyphenation repair, file-type detection, retrieval filtering/fallback/budget/incremental re-indexing, no answer keys indexed, request trimming to the size limit, contract-only passage fields, card text conversion, Dexie v5 source/chat storage); contract 6. Type checks and the production build pass; pdf.js and mammoth are separate chunks.
- Browser, live gateway (`deepseek-flash`), synthetic files only: a 2-page PDF, a .docx and a .md were each read (2, 1 and 1 passages); a duplicate, a corrupt PDF and a PNG were refused with specific messages. A question answered in 1.2 s (399 prompt / 115 completion tokens), grounded in the PDF with correct `[S1]`/`[S2]` citations; the citation opened the exact passage (photosynthesis.pdf, p. 2). Add to page inserted one card (3 → 4 cards); Undo removed it and the removal persisted across reload; chat history and panel state survived reload. Stop kept the partial answer marked "Stopped early" and the gateway logged `cancelled`. The gateway log held metadata only.
- **A defect found in the browser:** the first request was refused by the gateway because the browser sent an internal `citation` field with each passage. `buildChatRequest` now sends only the contract's four fields, with a regression test.

## Limitations (not verified or not built)

- Scanned PDFs (no text layer) are refused; there is no OCR. Password-protected PDFs are refused.
- Original files are not kept, only their text; sources and chat history are **not** in `.ainotebook` archives yet, so they do not transfer between devices.
- Keyword search misses paraphrases with no shared words. Retrieval quality has not been evaluated beyond this smoke test.
- A cancelled chat is not counted against the daily token budget (the same limitation canvas actions have), although DeepSeek may still bill it.
- Chat answers added to the page carry no per-source provenance in `sources`; the references are in the card text.
- Large real PDFs (hundreds of pages), tablets, and pen/touch use of the panel are untested. At phone width the panel works as a sheet, but the rest of the app shell is not yet laid out for phones.
