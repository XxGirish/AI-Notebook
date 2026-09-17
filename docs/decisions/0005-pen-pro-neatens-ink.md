# 0005 — Pen Pro neatens the writer's own ink

Date: 2026-09-17
Status: accepted; feel on real handwriting and pen devices unverified
Supersedes: 0004 (on-device handwriting-to-text)

## Decision

After trying text conversion, the user asked for Pen Pro to keep their own letters in a sketch style and improve the curves, instead of replacing writing with a typed font. About 1.2 s after the writer pauses, Pen Pro neatens the strokes written since the last pause. It also neatens immediately when writing resumes clearly elsewhere or the user switches tools. The ordinary Pen is unchanged.

Neatening is pure geometry in `apps/web/src/canvas/handwriting/neatenInk.ts`. It needs no model or network and works offline instantly. For each line (reusing the existing line grouping):

1. **Level the line.** A least-squares fit through every sample measures the writing angle. If the line is wider than 1.5× its height and tilted between 1° and 20°, all its strokes rotate rigidly about the line centre, so letter shapes and sizes are unchanged. Steeper lines are treated as intentional, such as a diagonal label or an arrow.
2. **Smooth the curves.** Each stroke is resampled to even spacing (line height / 40, clamped to 0.75–2 world units), then smoothed with repeated [1, 2, 1] passes. The smoothing reach is about 4.5% of line height, clamped to 1.2–5 units, and endpoints stay fixed. The reach scales with writing size, which removes tremor while keeping small loops (o, e) from visibly shrinking. Dots and tiny ticks are not smoothed.
3. **Even the weight.** Pressure is pulled 65% toward the line's median, so blotchy or thin spots render at a more consistent width.

The result is committed as one history step after the strokes themselves. IDs are kept and revisions increase. Strokes that were erased, moved or changed before the pause fires are skipped, and highlighter strokes are never touched.

The option to redraw words in a handwriting-style font was offered and not chosen.

## Consequences

- The TrOCR recognizer, its Web Worker, `@huggingface/transformers` and the bundled 27 MB ONNX runtime were removed. The service worker again precaches the whole (much smaller) build.
- Page schema 3 and the `ink-text` object remain. Notes that already contain converted words still load, edit, export and turn back into ink. Pen Pro no longer creates them.
- Browsers that used the earlier version may still hold about 64 MB of model files in the `transformers-cache` Cache Storage entry. The app does not delete it. Clearing site data for the origin removes it.

## Evidence

- Unit tests: a wobbly 40-unit arc ends up with less than a third of its deviation, endpoints unchanged. A word tilted 10° uphill is levelled to under 1° with letter height preserved. Steep lines and dots are left alone. A pressure spike is evened out. Stale, erased and highlighter strokes are untouched, and other objects are unchanged. In total 105 web tests, workspace type checks and the production build pass.
- Not verified live: the in-app preview pane was hidden, so the Konva canvas did not render. The pause-to-neaten flow was not observed in a browser.

## Limitations

- Undo restores the exact original strokes, but only while history exists. After a reload the neatened strokes are the saved ink.
- It does not correct badly formed letters, uneven letter heights, bouncing letters, spacing or slant. Those need letter segmentation that could damage legibility, and are possible follow-ups.
- Smoothing strength is a first guess. It needs tuning on real pen input (desktop pen, iPad Pencil, Android stylus).
