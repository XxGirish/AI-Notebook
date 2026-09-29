# 0003 — Same-origin AI gateway with a shared proposal contract

Date: 2026-09-17
Status: accepted for implementation; live DeepSeek behavior unverified

## Decision

AI requests go through `apps/gateway`, a small Node.js service built with Hono 4.13.8 and `@hono/node-server` 2.1.1 (both MIT), run with `tsx` 4.23.13. The browser never receives the DeepSeek key. In development, Vite proxies `/api` to the gateway on `127.0.0.1:8787`, so the app and gateway share an origin.

The proposal schema, gateway request envelope, stream events, and error codes live in `packages/ai-contract` (Zod 4.6.5). The gateway validates proposals with the same code the browser uses, which lets it perform the single permitted repair before anything reaches the client. The browser still rechecks page and source revisions at commit time; gateway validation grants no write access.

`POST /api/ai/generate` accepts a bounded envelope (64 KiB; typed text, LaTeX, quiz prompts without answer keys, and diagram semantics) and returns Server-Sent Events: `started`, `progress`, `usage`, `proposal` (only a complete validated proposal), `complete`, or `error` with a code and retryability. `POST /api/ai/cancel` aborts the running request. `GET /api/ai/capabilities` reports the configured provider and marks image input `unverified`. `GET /api/health` is public and contains no configuration.

The DeepSeek provider defaults to `deepseek-flash`, disables thinking, and forces one strict `propose_canvas_patch` function on the beta base URL. The function schema is generated from the application schema and reduced to DeepSeek's documented strict subset: optional fields become nullable-but-required, `const`/`oneOf` become `enum`/`anyOf`, length/count/range keywords are removed and enforced locally, and only request-permitted operation variants are offered. `DEEPSEEK_OUTPUT_MODE=json_object` switches to JSON Output on the standard endpoint as an explicit fallback. A deterministic `MockProvider` is the default and needs no credentials.

## Protections

- `DEEPSEEK_API_KEY` and `GATEWAY_ACCESS_TOKEN` are read only from the server environment (`apps/gateway/.env`, ignored). Startup requires both for the live provider, and requires the access token for any non-loopback host. AI routes compare a bearer token using fixed-length digests.
- One in-flight generation per gateway process, a per-minute window, daily request/token budgets, a server timeout, and rejection of reused request IDs. These counters are in memory and reset on restart. (2026-09-29: failed calls are charged too — reported usage when DeepSeek sent it, otherwise a high estimate when the request reached DeepSeek; see 0013.)
- Streamed tool arguments and content are reassembled before parsing; reasoning content is ignored. Finish reasons, keep-alives, malformed events, missing completion, HTTP 401/402/422/429/5xx, cancellation, and timeout map to distinct error codes.
- Notebook context is framed as untrusted material, and `<` is escaped so notebook text cannot close its context block. Model output is only ever parsed as proposal JSON.
- Logs contain request ID, intent, provider/model/configuration, outcome, error code, call and repair counts, latency, and token usage — never context, prompts, outputs, or keys. The service worker no longer intercepts `/api` routes.

## Evidence

- Current official documentation was re-read on 2026-09-17: [models and pricing](https://api-docs.deepseek.com/quick_start/pricing/), [strict tool calls](https://api-docs.deepseek.com/guides/tool_calls/), [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/), and the [changelog](https://api-docs.deepseek.com/updates/). They confirm `deepseek-flash` (V4.1 Flash, image input) and `deepseek-v4-pro` (no image input), the beta strict mode and its unsupported keywords, and that a forced `tool_choice` is unsupported with thinking enabled. The strict guide now states strict mode works in thinking and non-thinking modes.
- 38 gateway tests use a fake `fetch` and scripted mock outputs: request shape (beta URL, thinking disabled, forced strict tool, no key in the body), argument reassembly across chunks, JSON fallback, HTTP and finish-reason classification, SSE fragmentation/CRLF/UTF-8/keep-alives, schema keyword compliance, repair and failed repair, unpermitted operations, limits, configuration secrecy, authentication, body limits, replay rejection, concurrent refusal, cancellation, timeout, and log redaction.
- A local smoke test streamed a mock proposal through the Vite proxy and rejected a replayed request ID with HTTP 409.

## Not yet verified

No request has been sent to DeepSeek with a real key. Account model access, actual strict-schema acceptance of the generated schema, forced tool behavior, streaming details, usage fields, error bodies, latency, cost, and output quality remain unverified until a live capability probe. Image input is not sent. The browser does not yet call the gateway; the existing "Mock lesson" button still uses the in-browser fixture. Limits reset on restart, so they do not guarantee a spend ceiling; use DeepSeek account-side limits as well. Production HTTPS/same-origin deployment is not configured.

## Alternatives considered

- **Call DeepSeek from the browser:** rejected because it exposes the key.
- **Validate only in the browser:** rejected because the one bounded repair needs validation results next to the provider call.
- **Express or Fastify:** workable, but Hono's web-standard `Request`/`Response` model and SSE helper keep the service and its tests small.
- **An agent framework or multi-round tool loop:** unnecessary for one bounded proposal per explicit action.
