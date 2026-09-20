# 0008 — Remove capacitive-pen wobble from diagonal strokes

Date: 2026-09-20
Status: accepted. Measured on a screenshot from the user's device, synthetic input in unit tests, and synthetic pen events in the in-app browser. Not yet checked with a physical pen after the change.
Amends: 0007 (strokes are no longer drawn from raw samples)

## Problem

With a stylus, horizontal and vertical lines came out straight, but diagonal and slightly tilted lines came out as regular waves or staircases. Measured on the user's screenshot (pen width 4.5):

| Stroke | Sideways swing (detrended) | Repeats every |
|---|---|---|
| Diagonals, 35–45° | ±3–4.4 px, RMS 1.5–2.0 | 38–47 px along the line |
| Horizontal, vertical | RMS 0.8–1.2, mostly slow drift | 90+ px |

This is the known "diagonal wobble" of capacitive pen digitizers. Each axis's reported position is pulled toward the nearest sensor electrode, so the error repeats with the electrode pitch (about 30 screen px here). On a horizontal or vertical line the pull only slides the pen along the stroke, where it cannot be seen. On a diagonal, both axes err at once and the line becomes a staircase. The app's own input path was ruled out: it keeps fractional coordinates and coalesced events.

Until 0007, perfect-freehand's `streamline` hid the wobble, at the cost of lag and shrunken small loops. 0007 removed it and drew the raw samples, so the wobble showed.

## Why not ordinary smoothing

The wobble is the same size as handwriting: a ±3 px swing every 40 px, against letters 10–30 px tall. 0007 already measured that an arc-length Gaussian lowers small-writing accuracy. An exponential filter (streamline, One Euro) also lags the tip, which 0007 removed on purpose.

## Decision

`apps/web/src/canvas/digitizerWobble.ts` filters each stroke when it is captured: the live (wet) stroke on every move, and the committed stroke at pen-up. Both use the same filter, so the ink does not shift when it dries. Committed points are stored filtered. Only x and y change; pressure and time are kept.

- **Gated local quadratic fits.** Weighted quadratics are fitted along arc length at Gaussian widths of 28, 48, 84 and 128 screen px. A sample moves onto a fit only if (a) the fit's RMS residual is within the wobble's (full trust up to 2.4 px, none from 3.4 px), (b) at least two widths of stroke support it, and (c) its curvature bias σ⁴κ³/8 is under 0.2–0.6 px. The widest width that passes wins, so long lines come out straight. A quadratic follows constant curvature, so arcs are not shrunk.
- **Corners** of 65° or more split the stroke, measured with 14 px chords. The real wobble turns the stroke by at most about 37°.
- **Ends and corners are pinned.** Windows narrow toward them (at most 1.5 × the distance), so the first sample and the live tip never move. The tip stays under the pen and joins the delegated ink trail and predictions exactly.
- **Screen units.** Distances are screen px converted with the camera scale at capture, because the wobble belongs to the screen, not the page.
- **Cost.** Fits run on a grid of 8 nodes per width, so the cost is roughly the same as outlining the stroke: 0.2 ms for a 400 px line, about 1 ms for a 2,000 px stroke.

Rejected after measurement:

- A 16 px narrowest width. It moved samples of clean cursive written 20 px and larger by up to 4 px, where loops meet straight stems.
- A max-deviation gate. It cut straightening on harsher wobble without protecting handwriting any better.
- Unpinned (extrapolated) ends. Boundary fits curled as much as the raw ends did.

## Result

Synthetic digitizer model: 32 px pitch, 2.5 px pull per axis, a bit harsher than the device.

| | Before | After |
|---|---|---|
| 300 px lines at 20–70°, interior sideways swing | max 3.1–3.6, RMS 1.7–2.3 | max ≤ 1.15, RMS ≤ 0.28 |
| Arc, R 150 | RMS 1.4–1.8 | RMS 0.5–0.9, radius unchanged (≤ 0.22) |
| Clean cursive, x-height 10–24 | — | largest move < 0.04 px |
| Clean cursive, x-height 32–40 | — | ≤ 2 px on 2–5% of samples (long stems meeting loops) |
| Clean zigzag corners | — | ≤ 0.15 px (the true corner falls between samples) |

In-app browser: the same wobble injected through synthetic pen events drew straight committed ink on 40°, 60° and 15° lines. Cursive loops were unchanged, zigzag corners stayed sharp, and no wet ink was left behind.

## Limitations

- **Short strokes and small circles keep their wobble.** Runs shorter than about 60 screen px (two narrowest widths) are left as drawn, and so are circles under about 100 px across. At that size the wobble cannot be told apart from letters.
- **Steep or shallow strokes keep a slow bow.** Along near-vertical and near-horizontal strokes, the other axis's error repeats every 100+ px. On short sides, such as the 140 px legs of a zigzag, about half remains.
- **Stroke ends can keep a small hook.** The last 10–15 px keep up to the raw wobble, because the ends are pinned.
- **Device calibration is not attempted.** The error is a fixed function of screen position, so learning it per device would also clean up handwriting. That is left for later.
