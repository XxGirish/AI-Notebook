# 0010 — Draw all committed ink from one canvas node

Date: 2026-09-20
Status: accepted, on a smaller claim than the one it set out to prove. Measured synchronously in the running application at about 1,450 strokes. Not checked on a tablet.
Amends: 0009 (whose "remaining stall" is retracted here)

## What this was meant to fix, and why that was wrong

0009 recorded a stall of up to 430 ms per committed stroke at 1,000 strokes,
present even with saving switched off, and named the commit's rendering as the
cause. That figure does not hold.

It came from a wall-clock ticker (`setTimeout`, and the gap to the next
`requestAnimationFrame`) run while the Claude browser pane was hidden. A hidden
pane throttles both, and Konva schedules its redraws through
`requestAnimationFrame` — so those runs were measuring the throttle, and part of
the time the canvas was not redrawing at all. The same measurement gave 94 ms
one run and 430 ms another on the same page, which should have been the tell.

Measured synchronously instead, which the throttle cannot affect, a commit at
about 1,450 strokes costs:

| Part of a commit | |
|---|---|
| `pointerdown` handler | 0.3 ms median |
| ten `pointermove` handlers together | 0.6 ms median |
| `pointerup`, which commits the stroke | 0.2 ms median |
| saving (synchronous part, 0009) | 0.4 ms median |
| redrawing every stroke | 0.7 ms |
| React render and react-konva reconciliation | **2.4 ms median, 11.9 ms p95, 14.4 ms max** |

So there is no 430 ms stall. Redrawing the ink is not the cost either — filling
1,400 cached `Path2D`s takes 0.7 ms, as 0007 measured. The only part that both
follows page size and costs more than a millisecond is the last row.

## Decision

Committed ink was a react-konva `Shape` per stroke, so adding one stroke made
React build and diff a thousand elements and react-konva diff a thousand Konva
nodes. `InkStrokes.tsx` now renders **one** `Shape` whose scene function draws
every stroke from arrays passed as node attributes.

What used to be node properties is now that function's job, and is covered by
`InkStrokes.test.ts` against a fake canvas context that implements `save` and
`restore` properly, so an unbalanced pair fails the test:

- highlighters draw in a first pass, under the pen ink;
- the highlighter pass sets `globalAlpha` and `multiply` once, inside one
  `save`/`restore`, so pen ink is not blended;
- selected strokes get the `#ef8c45` outline at `2 / cameraScale`;
- a stroke being dragged is translated by its transient offset, which is undone
  before the next stroke.

## Result

Measured the same way, on the same page, by swapping only this file:

| React render and reconciliation, ~1,450 strokes | median | p95 | max |
|---|---|---|---|
| A `Shape` per stroke | 2.40 ms | 11.9 ms | 14.4 ms |
| One node for all strokes | 0.80 ms | 2.0 ms | 3.0 ms |

Three times cheaper at the median, six times at the 95th percentile, and it no
longer grows with the number of strokes, because the number of nodes no longer
does. In the browser, the fixture page renders identically: highlighter under
pen, and the selection outline appears on a lassoed stroke.

This is a few milliseconds, not the hundreds 0009 claimed. It is worth keeping —
it is the only remaining part of a commit that scaled with page size — but it
does not fix a stall, because there is no longer one to fix.

## Limitations

- **Nothing here was measured with the pane reliably visible.** Timer- and
  frame-based numbers cannot be trusted from this environment, so every figure
  above is a synchronous measurement instead. What a writer actually *feels* on
  a real screen, including whether frames are dropped, is still unmeasured.
- **Dragging grouped ink was not exercised in the browser**, because driving the
  card drag handle through synthetic events failed (`setPointerCapture` rejects
  a pointer id that no real pointer owns). The transient-offset path is covered
  by unit test only.
- **The ink layer still redraws in full** whenever anything changes. At 0.7 ms
  for 1,400 strokes that is not worth avoiding yet; a page many times larger
  would want the committed ink kept in a bitmap and added to incrementally.
- **Tablet and pen hardware are unchecked.**
