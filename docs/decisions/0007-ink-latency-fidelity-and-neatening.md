# 0007 — Low-latency ink, faithful small writing, and word-level Pen Pro neatening

Date: 2026-09-20
Status: accepted. Measured with synthetic input in unit tests and in the in-app browser. Not yet checked on physical pen or touch hardware.
Amends: 0005 (Pen Pro neatening algorithm)
Amended by: 0008 — strokes are now filtered for capacitive-pen diagonal wobble at capture; section 2 describes rendering from the raw samples.

The user reported three problems. Pen strokes lagged behind the pen or finger on tablets. Small cursive came out less accurate than it was written. Pen Pro barely changed handwriting. Each problem was measured before any fix was chosen.

## 1. Live-stroke latency

### What was measured (800-stroke page, in-app browser, synthetic pen events)

- **Every pointer move re-rendered the whole canvas component.** `trackContact` published the palm-rejection contact list to React state on every move, even outside palm mode. That render rebuilt the perfect-freehand geometry of every stroke on the page (20.5 ms for 800 strokes). Main-thread work per move was **60 ms median, 177 ms p95**, against a frame budget of 16.7 ms.
- The live stroke went through React state and then a Konva `batchDraw`. After the pointer event, it waited for an animation frame, then a React render task, then another animation frame before it was drawn. Each of those draws repainted every committed stroke, 11.3 ms with Konva's hit canvas.
- The ink layer was `listening` although none of its shapes have handlers. Konva therefore drew a hit canvas on every draw and read a pixel back from it (`getImageData`) on every pointer move.

### Decision

- **Wet ink** (`apps/web/src/canvas/wetInk.ts`): the stroke under the pen is drawn on its own `<canvas>`, synchronously in the pointer handler, and never goes through React. A finished stroke is committed as before. Its wet copy stays until the Konva layer has drawn the committed copy. The release frame is requested from a layout effect, after the frame Konva requested during the same commit, so the stroke is always visible on one surface or the other.
- **Delegated ink trail** (Ink API, Chromium on Windows): after each move the app reports the last event it drew. The OS compositor then draws the ink from that point to the current pen position. Where no presenter is available, `getPredictedEvents()` samples extend the drawn tip. They are capped at 8 screen px, so a wrong guess at a tight turn stays within the stroke width. Predictions are never stored.
- **Committed ink** (`InkStrokes.tsx`): a memoized component with one prebuilt `Path2D` per stroke, cached by the stroke's immutable points array. Each stroke is a single native `fill`, not a replay of path commands. The layer and shapes are `listening={false}`.
- Contact updates reach React only in palm mode, and only when the rounded contact footprints change. The canvas rectangle is read once per gesture, not on every move.

### Result (same page, same harness)

| | Before | After |
|---|---|---|
| React renders during a stroke | one per move | none (0 DOM mutations over 60 moves) |
| Move handler | — | 0.4 ms median |
| Live tip drawn when the handler returns | no (2+ frames later) | yes, 40 of 40 moves |
| Full redraw of committed ink (pan, zoom, pen-up) | 11.3 ms | 0.7 ms |

End-to-end latency on a display could not be measured: the preview pane was hidden and animation frames were throttled to about 2 per second.

## 2. Accuracy of small writing

### What was measured

Synthetic cursive (loops and arcades, sampled with 2/3-power-law pen speed) was rendered with our settings and compared with the ideal ink (all points within half a stroke width of the true path). In perfect-freehand 1.2.3, `streamline` is an exponential moving average: the drawn tip trails the pen and loops shrink. The outline also drops points closer than `size × smoothing` (3.7 units at our settings), and `getStrokePoints` skips the first `size` units of every stroke.

| Small cursive (x-height 10, pen 4.5) | IoU with ideal ink | Missing ink | Tip lag |
|---|---|---|---|
| Before, 240 Hz pen | 0.73 | 25% | 1.5 units |
| Before, 60 Hz touch | 0.40 | 59% | 2.5 units |
| After, 240 Hz pen | 0.99 | 1% | 0 |
| After, 60 Hz touch | 0.94 | 6% | 0 |

### Decision

`strokePath.ts` builds perfect-freehand stroke points itself: no streamline, no skipped start. It interpolates centripetal Catmull-Rom curves through every sample. The curve passes exactly through each sample and never overshoots, and it restores the curvature that straight chords lose between sparse samples. Outline decimation is `0.15 × size`, and `last: true` puts the tip exactly on the newest sample. A single tap now commits as a dot, so i-dots and full stops no longer disappear.

Rejected after measurement: an arc-length Gaussian de-noise (it lowered accuracy on both clean and noisy input), and coarser outlines (they save at most 40% of the points and cost accuracy; `Path2D` removed the drawing cost instead).

## 3. Pen Pro neatening

### What was measured

A generator (`handwriting/syntheticHandwriting.ts`) writes cursive words with known messiness: a tilted line, words drifting ±0.3 x-height, ±18% size, ±8° slant, ±4° word tilt, uneven gaps, and tremor. Neatness is scored by fitting each output word to its clean template, so the score does not depend on the neatener's own estimates. Averages over 8 lines:

| | Written | Previous Pen Pro | New Pen Pro |
|---|---|---|---|
| Baseline waviness (x-heights) | 0.164 | 0.184 | 0.008 |
| Line tilt | 4.2° | 0.2° | 0.02° |
| Word-tilt scatter | 2.7° | 2.4° | 1.0° |
| Size variation | 9.1% | 10.5% | 2.3% |
| Slant scatter | 3.7° | 6.9° | 2.2° |
| Gap variation | 0.25 | 0.23 | 0.02 |
| Shape error (tremor and distortion) | 0.087 | 0.192 | 0.048 |

The previous version only levelled the line. Its repeated [1, 2, 1] smoothing shrank loops, which roughly doubled shape error.

### Decision

The steps below are the skew, baseline, slant and size normalization used before handwriting recognition (see Simard, Steinkraus & Agrawala, *Ink normalization and beautification*, ICDAR 2005). Each word gets **one affine transform**, so its letterforms stay the writer's own:

1. Level the line using a Theil–Sen fit through letter bottoms. A few descenders cannot move the median of the pairwise slopes. Lines steeper than 20° keep their angle and are tidied along it.
2. Segment words by horizontal gaps wider than 0.55 x-height. Strokes that overlap horizontally, such as dots and crossbars, join their word.
3. Measure each word:
   - Baseline and midline: the densest band of letter bottoms and letter tops.
   - x-height: estimated for the line as the median height between consecutive vertical turning points.
   - Tilt: Theil–Sen through the letter bottoms.
   - Slant: the length-weighted median lean of downstrokes only. Using both directions doubled slant scatter.
4. Transform each word about its own baseline: straighten it, shear it to the line's slant, scale it to the line's x-height, and move it onto the common baseline. Size correction is limited to 0.7–1.45×, so capitals, digits and deliberately large words keep their size. Tilt and slant corrections use dead zones of 1° and 3°, the letter-dependent noise of the estimates, so neat writing is left alone. Without the dead zones a neat line gained 1.8° of slant scatter. Words too short to measure follow their neighbours up or down.
5. Even the gaps between words.
6. Remove tremor with Taubin λ|μ smoothing, which does not shrink shapes. Sharp corners are found on a pre-smoothed copy and pinned; on raw ink, tremor itself reads as corners.
7. Even out pressure, as before.

Words already written on the same line act as fixed references. A later burst of writing takes their baseline, x-height, slant and spacing, and the earlier words do not move.

## Evidence

- `strokePath.test.ts`: 6 tests. Five fail with the previous renderer (checked by swapping it in). The dot test passes with both, because the fix for dots is in `finishInput`.
- `neatenInk.test.ts`: 16 tests. The previous Pen Pro fails 10 of them. The 6 it passes cover retained behaviour: document safety, dots, pressure and the tremor arc.
- Workspace type checks, all tests (gateway 38, web 155, contract 6) and the production build pass.
- In-app browser, synthetic pen events: wet ink is drawn synchronously, the committed copy replaces it with nothing left behind, Pen Pro neatens after the pause, and a single Undo restores the original strokes.

## Not verified / limitations

- **No physical pen or touch testing.** That includes perceived latency, the delegated ink trail (it only runs with trusted events on supported Chromium builds), prediction quality on real input, and neatening on real handwriting.
- `desynchronized` (low-latency) canvases and `pointerrawupdate` were not adopted. Front-buffer rendering can flicker when a canvas is cleared and redrawn, and that needs device testing first.
- **Saving still stalls input after each stroke.** Each commit writes the whole page to IndexedDB twice, once as the recovery snapshot and once as the page. That is about 26–34 ms of synchronous cloning per write on an 800-stroke page, showing up as 70–100 ms long tasks. A stroke started right after pen-up waits. The fix is incremental persistence, left for a separate change because it touches save and recovery semantics.
- Word segmentation relies on gaps. Very tight word spacing merges words; they are then neatened together, which is safe but corrects less.
- Letter-level consistency, such as averaging repeated letters (Zitnick, *Handwriting beautification using token means*, SIGGRAPH 2013), is not attempted.
