# 0009 — Store pages as object rows so a save writes only what changed

Date: 2026-09-20
Status: accepted. Measured in Node against a real IndexedDB implementation, in the in-app browser against the browser's own IndexedDB, and in the running application at 1,000 strokes. Not yet checked on a tablet.
Amends: 0007 (which named this stall as the next thing to fix)

## Problem

Every committed stroke saved the whole page twice. `savePage` deep-cloned the
page, read the stored page back, migrated it, cloned it again as the recoverable
prior state, wrote that, and then wrote the page. The cost grew with the
notebook, not with the change, so writing became slower the more had been
written.

Measured in Node against a real IndexedDB implementation (one added stroke, the
page already holding the stated number):

| Page | Deep clone | Recovery clone | Whole `savePage` |
|---|---|---|---|
| 200 strokes (618 KiB) | 10.5 ms | 10.1 ms | 51.3 ms median, 82.5 ms max |
| 800 strokes (2,490 KiB) | 32.3 ms | 42.8 ms | 231.7 ms median, 291.7 ms max |

In the browser's own IndexedDB, at 800 strokes, writing the page record took
92.4 ms and the old save did that twice.

## Decision

A page is stored as one small metadata row plus one row per object.

- **`pages`** keeps the page's own fields plus `objectIds`, which carries the
  document order. Reordering rewrites that array and no object rows.
- **`pageObjects`** is keyed `[pageId+objectId]`, with `kind` lifted out of the
  object and indexed so asset cleanup can find images without reading ink.
- **The recoverable prior state is a patch, not a copy.** It holds the metadata
  as it was and only the objects the save changed (`null` where an object did
  not exist). Restoring applies it and leaves the state it replaced as the new
  patch, so a restore is still reversible — the behaviour 0002 shipped, at the
  cost of the change rather than the page.
- **Change detection is object identity** (`pageDelta.ts`). The document model
  is persistent: a command produces new objects for what it touched and keeps
  every other reference, which is how `domain/history.ts` already decides
  whether anything happened. Objects loaded from storage flow into the canvas
  unchanged, so the identities line up from load to save.
- **A tab keeps a mirror of what it last wrote**, so an ordinary save never
  reads the page back. The mirror is dropped whenever a write fails or another
  tab wins the conflict check, and the next save then reads the stored objects
  and rewrites whatever differs.
- **The database schema goes to version 4** and its upgrade splits existing
  page records into rows and converts each stored snapshot into a patch
  covering all of its objects. The *document* schema is untouched at 4:
  archives still carry whole pages, so export and import are unaffected.
- **Duplicate object ids are refused** at save and at load. One row per id means
  a repeated id would silently lose an object; failing the write keeps the loss
  visible and writes nothing.

## Result

Same Node harness, one added stroke:

| Page | `savePage` before | after |
|---|---|---|
| 200 strokes | 51.3 ms median | 4.9 ms median |
| 800 strokes | 231.7 ms median, 291.7 ms max | 5.4 ms median, 10.7 ms max |

The cost no longer follows the page: 200 and 800 strokes now save alike. In the
browser's own IndexedDB, writing one object row takes 1.8 ms against 92.4 ms for
the page record.

In the running application at 1,000 strokes, the synchronous part of a save —
the diff, the mirror update and the clone of what will be written — is **0.4 ms
median, 0.7 ms max**. Drawing 1,000 strokes, reloading, restoring the previous
version, restoring again, and deleting the pages all behaved correctly, and
deleting returned origin storage to its exact pre-test figure, so no object rows
are left behind.

## Cost

**Loading a page is slower.** Reading 800 object rows takes 115 ms against 56 ms
for one page record. Broken down: about 20 ms is per-row overhead (25 µs a row),
about 9 ms is the row wrapper, and the rest is that the same 38,400 point
objects cost more to deserialize split across records than together. This is a
once-per-load cost against a once-per-stroke saving, so it was accepted.

The fix for it is to stop storing each sample as an object: the same strokes
packed into `Float32Array` coordinates read in 45 ms, faster than the whole-page
record ever was. That changes the stored shape of a stroke and needs a document
migration, so it is left for its own change.

## Limitations

- **The "remaining stall" first recorded here was a measurement artifact.** It
  was measured with a wall-clock ticker while the browser pane was hidden, which
  throttles timers and `requestAnimationFrame`; Konva redraws through
  `requestAnimationFrame`, so those runs were largely measuring the throttle, not
  the app. Measured synchronously instead, the rest of a commit at 1,400 strokes
  is a few milliseconds in total (see 0010). Storage was the real cost, and it
  is the part this change removed.
- **Object identity is load-bearing.** An object mutated in place, without a new
  reference, would not be written. The document model never does this, and
  `domain/history.ts` would already miss such a change too, but the invariant is
  now also a durability one.
- **Rows the metadata no longer lists are ignored on load** rather than removed.
  They can only come from an interrupted write, and the next save that falls
  back to reading stored objects deletes them.
- **Tablet and pen hardware are unchecked.** Everything above was measured on a
  desktop browser with synthetic pen events.
