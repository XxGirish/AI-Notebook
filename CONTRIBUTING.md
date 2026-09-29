# Contributing

Thanks for your interest. AI Notebook is a personal-alpha project being prepared for an open-source release. Until a licence is chosen and added (see below), please open an issue to discuss a change before sending code.

## Getting started

Requirements: Node.js 24 and npm 11. No AI account is needed: the gateway uses a deterministic mock provider by default.

```bash
npm install
npm run dev            # the notebook
npm run dev:gateway    # optional AI gateway, mock provider
```

Before sending a change, run what CI runs:

```bash
npm run typecheck
npm test
npm run build
npm run eval --workspace @ai-notebook/gateway -- --dry-run
```

## How the project works

Read these first; they are short compared with the code they explain:

- `AGENTS.md` — the project's standing rules: what the product must do, the architecture, and what must never happen (for example, AI output mutating a page without validation, or a key reaching the browser).
- `IMPLEMENTATION_PLAN.md` — the build plan with a dated record of each milestone, including what was *not* verified.
- `docs/decisions/` — why each settled choice was made.

A few rules matter more than the rest:

- **The semantic document is the source of truth.** Konva draws a projection of it. Changes go through validated document commands that are undoable and saved at command boundaries.
- **AI output is untrusted.** It is a proposal, validated in the gateway and again on the device, allocated IDs by the app, and committed as one undoable batch. It can never carry code, raw engine state, or permissions.
- **Never lose the writer's work.** Anything that touches storage, migrations or archives needs tests for failure and for old data.
- **Say what was checked.** A change that could behave differently on a tablet, a pen or a real DeepSeek account should say whether it was tried there. Synthetic browser events are not device testing.

## Tests

Tests sit next to the code they cover (`*.test.ts`) and run with Vitest; IndexedDB tests use `fake-indexeddb`. Prefer tests of behaviour and invariants (round trips, refusals, undo, old data) over tests that restate the implementation. Never use real notebooks, private documents or real API keys in fixtures: write synthetic ones.

## Commits and pull requests

Small, focused commits with a message that says what changed and why. In the pull request, describe how you verified the change and anything you could not verify.

## Licence

No licence has been chosen yet, so the code is not yet open for reuse. One will be chosen and added before the public release, after checking the licences of every shipped dependency; this file will then say how contributions are licensed.
