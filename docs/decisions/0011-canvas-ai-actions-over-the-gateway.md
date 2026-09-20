# 0011 — Canvas AI actions run over the gateway

Date: 2026-09-20
Status: accepted, mock-verified. No live DeepSeek request has been made.
Builds on: 0003 (the gateway and provider contract)

## What was missing

0003 built the server half of Phase 3 — the shared contract, the Hono gateway,
the DeepSeek provider, a deterministic mock provider — and left one sentence in
the plan: *the web app does not call the gateway yet*. The only AI action on the
canvas was "Mock lesson", which compiled a fixture proposal on the device and
never opened a socket.

This connects the two halves: four canvas actions that send a bounded request,
stream the answer, and produce the same reviewable draft the fixture already
produced.

## The shape of it

Three modules, deliberately separate, because they fail in different ways and
are worth testing apart:

| Module | Job |
|---|---|
| `ai/requestContext.ts` | Turn the page and the selection into one bounded `GenerateRequest` |
| `ai/gatewayClient.ts` | Speak the protocol: POST, parse the SSE stream, cancel, map errors to readable text |
| `ai/aiSession.ts` | Run one action end to end and return a draft, a cancellation, or a typed error |

`KonvaPrototype` holds only the state the writer can see: which action is
running, its phase, the error and whether it is worth retrying.

## What the browser decides, and what it re-decides

An action carries a *plan*: which semantic operations it permits, how many, and
whether it needs a selection. The plan is sent with the request, and the same
plan validates the returned proposal again on the device, against the page's
current revisions. The gateway already validates; that check is not trusted,
because the browser owns the document and the page may have changed while the
request was in flight. A proposal is refused twice over before it can reach a
page, and accepting a draft rechecks revisions a third time.

No plan permits `propose_object_update`, and every request sends an empty
`targets` list. Nothing a model returns can rewrite an object that already
exists on the page; today's actions only insert. That restriction is in the
contract for later, not in use.

## What leaves the device

Only text, and only what the action needs:

- Selected cards, notes, converted handwriting and derived diagrams, then the
  nearest neighbours outward from the selection or the middle of the view.
- **Not** a quiz's answer key or its rationale. A quiz travels as its prompt and
  option labels. No action needs the answer to produce new work, and a stored
  answer is exactly the thing a learner should not be able to leak back to
  themselves through a generated explanation.
- **Not** ink or pictures: they carry no text, and image input is not
  implemented.

Over-long notes are trimmed at the contract's own ceilings rather than refused,
and the least relevant context is dropped until the request fits the gateway's
64 KiB limit — so a full page cannot make an action simply stop working.

## The access token

`VITE_GATEWAY_ACCESS_TOKEN` is built into the bundle, and so is readable by
anyone who can open the app. That is acceptable for what it does: keep other
people on the same network off a personal gateway. It is not a secret from the
person using the notebook, and it is not the DeepSeek key, which never leaves
the gateway process. A deployment that needs real user authentication needs a
session in front of the gateway, not a bundled string.

## Two defects the browser check found

Both in error reporting, both fixed with tests:

1. With the gateway stopped, the development proxy answers 502 and the app said
   **"DeepSeek could not be reached."** The gateway was the thing that could not
   be reached; DeepSeek was never involved. A response with no gateway error
   body now says so and names the status.
2. That same failure offered no **Try again**, because an error without a body
   defaulted to non-retryable — exactly backwards for a 5xx, where the gateway
   coming back up is the likely fix.

## Verified

Against a real gateway on the mock provider, in the browser:

- "Teach a section" with nothing selected: one POST to `/api/ai/generate`,
  streamed, 11 editable objects drafted without touching the page; the request
  carried 1,191 bytes, four context items, one permitted operation, no targets
  and no answer key.
- "Add to page" moved the reading view from 4 items to 11 in one step; Ctrl+Z
  went back to 4, Ctrl+Y forward to 11, and a reload kept 11.
- "Explain selection" with nothing selected was refused on the device, with no
  network request.
- Gateway stopped: the 502 message above, with Try again; restarting it and
  pressing Try again produced a draft.
- The per-minute limit surfaced as "Too many requests in the last minute" with
  Try again.
- The gateway logged redacted metadata only — request id, intent, provider,
  model, outcome, latency, token counts. No context, no prompt, no output.

## Not verified

- **Any live DeepSeek request.** Account access, whether the real model's output
  passes `validateCanvasProposal` often enough to be usable, latency, cost and
  quality are all still unknown. The mock provider proves the wiring, not the
  model.
- Cancelling a generation in the browser: the mock answers in ~34 ms, so there
  is nothing to cancel by hand. The cancel path — abort the stream, then ask the
  gateway to stop the provider call so it stops spending tokens — is covered by
  a test, not by a gesture.
- Two tabs competing for the gateway's single in-flight slot.
- Pen and tablet hardware, as everywhere else in this phase.
