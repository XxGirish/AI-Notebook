# 0004 — Pen Pro: on-device handwriting-to-text

Date: 2026-09-17
Status: superseded by 0005 on 2026-09-17 (Pen Pro now neatens ink instead of recognizing text)

## Decision

A separate **Pen Pro** tool (shortcut `W`) turns handwriting into typed text automatically about 1.2 s after the writer pauses. It also converts right away when writing resumes clearly elsewhere or the user switches tools. The ordinary Pen is unchanged. This is not an AI feature under the product rules: nothing is sent to DeepSeek or any other inference service, and it does not use the gateway.

Recognition uses Microsoft TrOCR-small-handwritten, 8-bit quantized ONNX weights from `Xenova/trocr-small-handwritten`, pinned to revision `2432e24d184b1d964d07ed04f5d9e21d31a59141`. It runs in a Web Worker through `@huggingface/transformers` 4.3.0 (Apache-2.0), which uses `onnxruntime-web` 1.31.0-dev.20260914 on the WASM backend. The ONNX runtime files are bundled and served by the app itself, not transformers.js's default jsDelivr CDN. The service worker leaves the roughly 27 MB `.wasm` out of its precache list, so it is cached the first time Pen Pro is used rather than on every app update.

The user chose this approach. Chrome's Handwriting Recognition API was rejected because it ships only on ChromeOS. Server or LLM recognition was rejected because the user explicitly wanted a feature unrelated to DeepSeek, and because continuously sending ink would break the privacy and explicit-AI rules.

## Data model and safety

- Schema 3 adds an `ink-text` object: `text`, `fontSize`, `color`, `recognizedText` (the recognizer's original output), `recognizer`, and `sourceStrokes`, the complete original strokes. Pages from schema 2 or earlier cannot contain it. Older cached app code refuses schema-3 pages instead of misreading them.
- Pen Pro strokes are committed and saved as normal ink first. Conversion then replaces each recognized line with one `ink-text` object in a single undoable history step. Undo brings the ink back.
- Revision checks run both before and again at commit. If a stroke was erased, moved or edited while recognition ran, or the recognizer returned nothing, that line keeps its ink. A failure, including never having downloaded the model while offline, keeps the ink and shows a notice.
- Strokes are split into lines by vertical-band overlap, and large horizontal gaps start separate segments. Only the strokes in a line are rasterized (64 px ink height, dark on white), so nearby content never reaches the recognizer.
- Double-clicking converted text, or using **Edit text**, lets the user correct it. **Back to handwriting** restores the preserved strokes at the text's current position with fresh IDs, including after reload or archive import.
- Converted text is included in archive validation, the linear reading view, the eraser, lasso/move/duplicate/delete, and SVG export. The preserved source ink is not exported.

## Evidence

- Unit tests cover line grouping, replacement order and geometry, stale/erased/empty-result guards, no double claiming of a stroke, text edits, and restoring ink after a move. They also cover archive round-trip and rejection of malformed preserved ink, schema-2 rejection, the reading view, and SVG escaping. Result: 102 web tests (12 new), type checking and the production build pass.
- A browser check (Chromium preview, desktop) recorded Pen Pro strokes on the canvas. It downloaded the model on first use from the pinned revision and loaded the runtime from the app's origin, not a CDN, confirmed by the `transformers-cache` entries. Synthetic block-letter "HI" was recognized as `"H. I"`. A synthetic lowercase "cat" made of geometric arcs was recognized as `"oat"`. Warm recognition of one line took about 0.6 s.

## Limitations and open items

- The first use needs network access to `huggingface.co` (about 64 MB of weights). After that, conversion works offline from Cache Storage, which requires a secure context. Self-hosting the weights is a possible follow-up.
- English only, one line at a time; no maths, diagrams or other scripts. TrOCR returns no confidence score, so wrong readings are fixed with Edit text or Back to handwriting. Synthetic geometric strokes are not representative of real handwriting. Accuracy on the user's own writing, tablets (iPad Safari, Android Chrome) and memory use on lower-end devices is untested.
- The full automatic pause-to-text commit was not observed in the live canvas: the preview pane went hidden and the Konva stage stopped rendering. It is covered by unit tests plus the separate live recognizer check.
- The Hugging Face model card for `microsoft/trocr-small-handwritten` has no license tag. The TrOCR source repository is MIT. Confirm the weight license before an open-source release.
