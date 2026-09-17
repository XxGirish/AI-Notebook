# 0002 — Coordinate one writable tab with Web Locks and stored revisions

Date: 2026-09-15
Status: accepted

## Decision

Use one origin-scoped exclusive Web Lock named `ai-notebook-writer` for the current single-notebook application. The first tab that acquires it can mutate notebook data. Other tabs remain readable and navigable but expose all document-changing controls as disabled.

A read-only tab may explicitly choose **Take over editing**. It requests the same lock with the platform `steal` option, reloads the latest IndexedDB state before enabling edits, and causes the displaced holder to become read-only. If Web Locks are unavailable, fail closed to read-only instead of allowing uncoordinated saves.

Treat the lock as coordination, not the final data-integrity boundary. Every page overwrite, delete, and recovery operation compares its expected `updatedAt` revision with the current record inside the same IndexedDB transaction. Page updates advance that value monotonically even if the wall clock does not. A mismatch rejects the operation, stops editing in that tab, and reloads stored content.

## Evidence

- Focused tests cover initial ownership, busy/read-only state, hydration before write enablement, explicit takeover, unsupported-browser behavior, monotonic revisions, and stale-write rejection.
- A two-tab Chromium browser check verified that only one tab exposed mutation controls, a second tab opened read-only, takeover transferred ownership, and the displaced tab immediately disabled page, canvas, history, import, and card-editing controls.
- The [Web Locks specification](https://www.w3.org/TR/web-locks/) defines exclusive origin-scoped locks and the explicit `steal` preemption behavior used here.

## Alternatives considered

- **Only compare timestamps:** prevents some lost updates but provides a poor editing experience because both tabs appear writable until a conflict occurs.
- **A localStorage heartbeat lease:** adds expiry, clock, background-throttling, and crash-recovery edge cases already handled by the browser lock manager.
- **Allow simultaneous saves:** rejected because competing whole-page autosaves can overwrite unrelated work.

## Consequences and remaining work

Web Locks require a secure context. Production and physical-tablet access therefore require HTTPS; localhost development remains supported. Browsers without Web Locks are intentionally read-only until a tested fallback is justified.

Takeover is an exceptional preemption: JavaScript already running in the displaced tab can continue briefly. Transactional revision checks are therefore mandatory and must not be removed even though normal UI coordination prevents concurrent editing. The current lock covers the whole local notebook because the application has one notebook containing multiple pages; a future multi-notebook model may use one lock per notebook ID.

## Amendment — 2026-09-17

A failed initial probe no longer leaves a tab read-only indefinitely. Readers, and holders displaced by a takeover, keep one abortable queued request for the same lock and become writable (after reloading stored content) once the lock is actually free, for example when the editing tab closes. Takeover and teardown abort that queued request, and a holder displaced while still hydrating cannot promote itself afterwards. This fixed a development StrictMode remount race in which the only open tab stayed read-only while no lock was held. Tests model the Web Locks queue with `ifAvailable`, `steal`, and abort signals; a two-tab Chromium check confirmed automatic promotion after the editing tab closed.
