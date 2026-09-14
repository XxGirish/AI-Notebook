# AI canvas architecture and direct DeepSeek API research

Research date: 13 September 2026. This memo reads `idea.md` as the product brief and uses the user's final choice of **the direct DeepSeek API**. It is a technical research and implementation proposal, not an implemented or benchmarked application. No authenticated requests or physical-device tests have been run. Recommendations and numeric acceptance targets are engineering judgments; linked capabilities and prices are researched provider facts.

## Recommendation

Build the first AI experience as a **bounded content generator connected to a deterministic canvas command executor**. The model receives selected semantic objects and, when needed, an image of selected handwriting. It returns a small lesson or proposed edit described in application-owned JSON. Application code checks that proposal, measures its content, lays it out, and commits it as an undoable operation.

Use **`deepseek-flash` as the first model to evaluate** for both text and selected images. Its currently documented underlying model is DeepSeek-V4.1-Flash. Compare `deepseek-v4-pro` only for text tasks where evidence justifies another configuration. Keep the model identifier configurable.

The distinctive work is the selection/context pipeline, editable lesson objects, layout, reliable application of actions, and tutoring interaction. A general autonomous agent framework, persistent multi-agent system, computer-use agent, or MCP server is not needed to prove those interactions.

Start with **Explain selection**, **Teach one section**, **Generate editable diagram**, and **Create three-question quiz**. Add bounded editing of existing content after insertion is reliable. Keep normal notebook interaction and stored quiz answer checking entirely local.

## 1. Direct DeepSeek API: verified choices and integration constraints

### Current models and endpoint

DeepSeek documents direct inference at `POST https://api.deepseek.com/chat/completions` and an OpenAI-compatible client format. A DeepSeek API key is required. Put a small `DeepSeekProvider` adapter in the backend; direct HTTP or the compatible SDK can provide transport while application request/response types remain provider independent. [First API call](https://api-docs.deepseek.com/).

| Candidate | Verified current role | Proposed use |
|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash; text and native visual understanding | First candidate for typed notes, cropped ink, diagrams, and quiz proposals. |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813; text, without vision | Optional text comparison if difficult-topic evaluation shows a benefit. |

The provider lists JSON output and tool calls for both models. [Current models and pricing](https://api-docs.deepseek.com/quick_start/pricing/).

**Avoid stale model advice.** DeepSeek's dated 10 September 2026 changelog announces V4.1-Flash and changes to legacy model routing. The current quickstart uses `deepseek-flash`; use that current name rather than copying older tutorials. The provider states V4 Pro service will continue beyond 14 September. [Dated changelog](https://api-docs.deepseek.com/updates/).

Record the requested model, returned model/fingerprint when provided, configuration, prompt version, and schema version. A model alias can move even when the application configuration remains unchanged. The documented `GET /models` endpoint can check account-visible identifiers during setup; a listing is not a quality benchmark. [List models](https://api-docs.deepseek.com/api/list-models/).

### Structured output: explicit primary path and fallback

**Primary path to validate in the first spike:** a single named `propose_canvas_patch` tool with thinking explicitly disabled and strict mode enabled on the beta endpoint. The tool returns a proposed application operation bundle; its name does not give the model direct access to the editor.

DeepSeek's strict tool mode is **Beta**, uses base URL `https://api.deepseek.com/beta`, and requires every supplied function to set `strict: true`. Objects require every property to be required and `additionalProperties: false`. The supported subset includes unions and arrays, but string `minLength`/`maxLength` and array `minItems`/`maxItems` are unsupported. Generate a provider-compatible schema and enforce those omitted limits in the full application validator. [Strict tool calls](https://api-docs.deepseek.com/guides/tool_calls/).

**Important interaction:** named or `required` tool choice is rejected in thinking mode. Set `thinking: {type: "disabled"}` explicitly for the forced proposal tool. Validate that the returned call is the expected tool, its arguments are complete, and the number of calls fits the application request. [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/).

**Fallback:** the standard endpoint with `response_format: {type: "json_object"}`. JSON Output ensures JSON syntax, not the application's full schema. Its guide requires an instruction containing “json” and an example, warns about truncation, and acknowledges occasional empty output. Validate the complete result and allow one targeted repair attempt; then preserve the original notebook and show a retryable failure. [JSON Output guide](https://api-docs.deepseek.com/guides/json_mode/).

Do not silently downgrade the integrity check if beta features are unavailable. The fallback still uses the same command validator. Never parse tool-like prose with permissive regular expressions, execute raw generated code, or convert malformed output into an empty successful edit.

### Thinking and conversation handling

Thinking is enabled by default with high effort. For latency-sensitive bounded proposals, explicitly disable it initially. Evaluate low/high effort separately for difficult checks where an automatic tool choice or plain structured response suffices. Do not assume lowering temperature controls thinking output.

The provider returns reasoning separately as `reasoning_content`. With tools present, it requires prior reasoning content to be replayed in subsequent requests, including previous turns without calls; omitting it can cause a 400 error. Without tools, earlier reasoning is ignored. Keep this protocol data separate from notebook content and normal logs. [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/).

The MVP usually needs a single output proposal, so it need not start a multi-round tool conversation at all. If read tools are later added, cap the loop in application code and retain the fields required by the chosen protocol. Do not save raw reasoning as a student's study notes.

### Images and handwriting inputs

`deepseek-flash` supports real image inputs; Pro does not. Use one locally rendered selected crop and accompanying semantic text, then evaluate transcription with the user's actual handwriting. The current visual model has superseded the older experimental alias; native vision support is evidence of modality, not proof of handwriting accuracy.

Chat Completions accepts `image_url` parts with an HTTP(S) URL or base64 data URL, including PNG/JPEG/WebP/GIF. For this notebook prefer a generated PNG crop. [Image payload reference](https://api-docs.deepseek.com/api/create-chat-completion/).

The published shared image limits include 32 MiB per inline image and 64 MiB total for requests without uploaded-file images. Set much smaller application limits appropriate to one selection, and do not use the provider's large maximum as a target. Its Responses guide also documents original/high/auto versus low-detail behavior; low downsamples to 512×512, which may lose small mathematical symbols. [Documented image limits and detail](https://api-docs.deepseek.com/guides/responses_api/).

### Streaming and protocol selection

Use Chat Completions for the initial bounded workflow to keep the integration small. Reassemble native tool arguments across stream chunks and commit only after a complete success result and local validation. Check finish reason; interruption, resource failure, filtering, and length limits are distinct from success.

The provider also supports a Responses API, but compatibility has limits: it is stateless, has no `previous_response_id` persistence, and ignores provider-side `max_tool_calls` and parallel-tool controls. Its stream ends in completed/incomplete/failed events rather than Chat Completions' `[DONE]` convention. If switching protocols, implement the corresponding parser rather than reusing incompatible assumptions. [Responses compatibility](https://api-docs.deepseek.com/guides/responses_api/).

DeepSeek documents account-level concurrency limits and SSE keep-alive comments, with empty lines on non-streamed waiting connections. Exceeding concurrency returns 429; a request that has not started inference after ten minutes is disconnected. Set a shorter application timeout and visible cancellation for interactive lessons. [Limits and keep-alive behavior](https://api-docs.deepseek.com/quick_start/rate_limit/).

### Capability spike

Record capabilities per endpoint + model + configuration, with “unverified” until exercised:

```ts
type ModelCapabilities = {
  text: boolean;
  images: boolean;
  streaming: boolean;
  nativeTools: boolean;
  forcedToolsWithoutThinking: boolean;
  toolRoundTrip: boolean;
  schemaMode: 'strict_tool_beta' | 'json_object' | 'prompt_only';
  supportsThinkingControl: boolean;
  maxVerifiedInputTokens: number;
  maxVerifiedOutputTokens: number;
};
```

The first spike should use synthetic inputs and test:

1. Plain text, authentication failure, and usage extraction.
2. A forced strict function with nested required fields and an enum; inspect the actual tool name/arguments.
3. Rejection of unsupported schema keywords; local enforcement of omitted size limits.
4. Image plus text using a known equation crop; an attempted image request to Pro must not silently produce a misleading result.
5. Stream fragmentation, keep-alive comments, finish reasons, empty output, truncation, cancellation, and budget exhaustion.
6. Thinking disabled versus enabled behavior; a real tool-result round trip with required reasoning replay if a loop is planned.
7. Strict beta unavailable/failing followed by the explicitly configured validated-JSON fallback.
8. 429/5xx retry handling, duplicate delivery, and preservation of notebook state throughout.

Keep the model endpoint and mode configurable, but do not send unsupported parameters “just in case.” Passing a field without an error does not establish that it is enforced. Endpoint access and response quality have not been tested on the user's account this turn.

### Minimal fallback request shape

This conceptual standard-endpoint request demonstrates the non-beta fallback. The actual prompt must include the full application schema and valid examples.

```json
{
  "model": "deepseek-flash",
  "messages": [
    {"role": "system", "content": "Return one bounded lesson proposal as JSON matching the supplied schema. Example: {\"schemaVersion\":1,\"operations\":[]}"},
    {"role": "user", "content": "Explain the selected loss-function note."}
  ],
  "thinking": {"type": "disabled"},
  "response_format": {"type": "json_object"},
  "max_tokens": 4096,
  "stream": true
}
```

The backend adds bearer authentication. For the primary strict path, replace the JSON-output configuration with the verified named tool definition on the beta base URL. Do not combine unsupported output modes or rely on model-generated authorization metadata.

### Pricing and personal-use budget

Published USD rates per million tokens, accessed 13 September 2026:

| Model/time | Cached input | Uncached input | Output |
|---|---:|---:|---:|
| Flash off-peak | $0.003 | $0.15 | $0.60 |
| Flash peak | $0.006 | $0.30 | $1.20 |
| Pro off-peak | $0.022 | $0.66 | $1.98 |
| Pro peak | $0.044 | $1.32 | $3.96 |

Peak periods are weekdays 01:00–04:00 and 06:00–10:00 UTC; other periods are off-peak. Prices can change. [Current pricing](https://api-docs.deepseek.com/quick_start/pricing/).

**Illustration, not a forecast:** 600 user actions plus 60 repair calls per month, each with 4,000 uncached input tokens and 2,000 billed output tokens, costs approximately **$1.19 off-peak or $2.38 peak on Flash**. This matches the main report's workload assumptions; larger lessons, additional reasoning, image tokens, hosting, and taxes change the result. Do not delay an interactive learner for cheaper hours.

Keep one gateway/account-wide in-flight request initially, a short queue, cancellable generation, and configurable daily request/token/spend caps. Count retries. Record estimated and actual billable usage when returned, model/mode, time to first usable section, total latency, error, and repair. Unknown usage is unknown, not zero. Budget reasoning using actual billed output, rather than visible answer length alone.

Use bounded exponential backoff and jitter for transient errors, honoring retry guidance when available. Do not silently change providers or launch background generations. Accepted lessons and stored MCQ checking are local and incur no repeated generation cost.

Keep `DEEPSEEK_API_KEY` only in the local/backend server environment, never in browser bundles, archives, fixtures, or source control. Each self-hoster supplies their own account/key. Include a mock provider and original sample lessons so the notebook and contribution workflow work without paid credentials. Verify the current DeepSeek service terms and privacy settings during account setup; selecting a region in application settings does not establish provider-side data residency.

## 2. The application owns the meaning of its AI tools

The model should work with concepts like an equation, explanation, directed graph, MCQ, and placement relative to a selection. It should not emit raw canvas-library records, arbitrary HTML/JavaScript, per-stroke drawing commands, guessed coordinates, or unrestricted JSON patches.

There are three levels:

1. **Tutor output:** pedagogical content and intent, such as an explanation and graph of loss leading to a gradient.
2. **Application commands:** typed operations such as `insert_lesson_section` and `attach_explanation`.
3. **Canvas adapter:** library-specific shape creation, ID binding, measuring, graph layout, selection, persistence, and history.

Separating these levels protects saved files and AI prompts from a future canvas engine change. Editable diagrams should consist of individual nodes and connectors with semantic IDs. A diagram that happens to render well as SVG is still not necessarily an editable graph; retain its graph data and a mapping to canvas objects.

Recommended initial commands:

| Command | Input | Scope |
|---|---|---|
| `insert_lesson_section` | title, ordered blocks, learning objective, source references | New content inside an app-assigned lesson frame. |
| `attach_explanation` | selected object references, explanation blocks | Add a linked explanation near a selected source. |
| `insert_diagram` | diagram kind, nodes, edges, labels, direction | Graph semantics; local layout sets geometry. |
| `insert_quiz` | question text, stable choice IDs, answer ID, explanation, concept IDs | Local interaction and answer checking. |
| `insert_flashcards` | front/back pairs, concept IDs, references | Optional after quizzes. |
| `propose_object_edit` | object reference, expected revision, allowlisted changed fields | Later phase; draft replacement of selected objects only. |

The dozen small create/move/group functions in `idea.md` remain useful **internal editor primitives**. Exposing all of them individually to the model creates long fragile action sequences. Prefer a small number of task-shaped tools that compile into those primitives. A single `propose_canvas_patch` provider function can carry these application operations if that makes model support simpler.

### Concrete semantic proposal

The application captures a request envelope before inference. Authorization metadata comes from the app, never from model-generated claims:

```json
{
  "requestId": "req_01",
  "pageId": "page_7",
  "selection": [{"id": "loss_note", "revision": 12}],
  "allowedExistingObjectIds": ["loss_note"],
  "contextHash": "sha256-of-exact-selected-context",
  "intent": "explain",
  "allowedOperations": ["attach_explanation", "insert_diagram"],
  "outputLimits": {"blocks": 8, "diagramNodes": 20, "diagramEdges": 30}
}
```

Model proposal, deliberately without global coordinates or database IDs:

```json
{
  "schemaVersion": 1,
  "operations": [
    {
      "type": "attach_explanation",
      "anchorRef": "loss_note",
      "placement": "beside",
      "title": "Why the loss matters",
      "blocks": [
        {"type": "text", "text": "The loss compares a prediction with a target. Training adjusts parameters to reduce that loss."},
        {"type": "equation", "latex": "L=(\\hat{y}-y)^2", "spokenText": "Loss equals predicted y minus target y, squared."}
      ],
      "sourceRefs": [{"objectId": "loss_note", "revision": 12}]
    },
    {
      "type": "insert_diagram",
      "anchorRef": "loss_note",
      "direction": "left_to_right",
      "nodes": [
        {"ref": "prediction", "label": "Prediction"},
        {"ref": "loss", "label": "Loss"},
        {"ref": "gradient", "label": "Gradient"}
      ],
      "edges": [
        {"from": "prediction", "to": "loss", "label": "compare with target"},
        {"from": "loss", "to": "gradient", "label": "differentiate"}
      ]
    }
  ]
}
```

The final JSON Schema should use explicit tagged unions, required fields, enums, size limits, and `additionalProperties: false`. Generate runtime validation and TypeScript types from one schema source, or derive JSON Schema from an application validation library; avoid separate handwritten schemas that drift. Provider schema subsets may require a simplified generated variant. Always run the full validator locally too.

Schema validity is only structural correctness: a schema can accept an incorrect equation or a misleading arrow. The application must separately evaluate semantic accuracy, source support, and pedagogical quality.

## 3. Context selection, including handwriting

Never send every canvas object or observe continuously. Make context capture a deterministic function that can be unit tested independently of the model.

For an explicit selection:

1. Find intersecting/selected objects using the canvas selection semantics, not only their screen pixel centers.
2. Include exact text, LaTeX, semantic diagram labels and edge relations, and relevant quiz prompt. Do not OCR text already stored as text.
3. Include the parent lesson heading and a bounded set of directly connected neighbor objects when useful. Label these as context neighbors, separate from the selected target.
4. When strokes or embedded images contain relevant meaning, render the selected region into a crop locally. Include sufficient margin and resolution for symbols; enforce image size/count limits. Avoid sending an unrelated full-page screenshot.
5. Include object IDs, revisions, source provenance, language, intended level, and the requested action. Freeze that input snapshot and hash it.
6. Show a compact “Using 4 selected objects + handwriting image” indicator and allow context inspection.

Keep the original vector strokes as the source of truth. A crop is a temporary inference input, while a recognition result is derived metadata associated with the exact stroke revision/hash. An edited stroke invalidates its cached transcription.

For page summaries, follow explicit reading order within lesson frames. Spatial proximity alone is not a reliable page-reading order. For search later, index semantic content and confirmed transcriptions; retrieve only relevant chunks, preserve source page/object IDs, and filter by notebook scope before sending them. A vector database is unnecessary for the first “explain selection” experience.

### Realistic handwriting approach

MVP: selected crop to the `deepseek-flash` visual model on user request. Return `recognizedText`, `recognizedLatex`, `uncertainSpans`, and an optional clarification along with the explanation. Keep the result editable. For “check my solution,” show what the model read before treating its evaluation as meaningful; `1/l`, `x/×`, sign changes, superscripts, and fraction bars are common test cases. A model's self-reported confidence is not a calibrated OCR accuracy score.

Do not market an LLM crop explanation as lossless handwriting recognition, and do not replace original strokes automatically. Test actual handwriting, device, subject, and language before choosing whether it is good enough. Documented visual input support does not prove personal handwriting recognition quality; that requires a separate task-specific evaluation.

If user testing identifies transcription as the bottleneck, introduce a separate recognizer adapter later:

| Alternative | Evidence and integration implication |
|---|---|
| Mathpix | Its `v3/strokes` API takes handwriting coordinates directly and returns recognized content including LaTeX. A separate service/account integration, useful for testing math transcription against vision crops. [Stroke API](https://docs.mathpix.com/reference/post-v3-strokes). |
| MyScript iink | Its web APIs/libraries support text, math, and raw ink content; REST is relevant when the notebook already captures strokes. A service dependency rather than a reason to replace the main canvas. [Web documentation](https://developer.myscript.com/docs/interactive-ink/latest/web/iinkts/), [REST recognizer](https://developer.myscript.com/docs/interactive-ink/4.4/web/rest/new-api/). |
| Google ML Kit digital ink | On-device stroke recognition for iOS and Android; its documented SDK is not a direct browser package. Useful if native mobile becomes a planned product. [Digital ink overview](https://developers.google.com/ml-kit/vision/digital-ink-recognition). |

These are alternatives to research only if needed, not additions to the user's chosen DeepSeek-only MVP. They have independent access and licensing requirements. Training a recognizer from scratch is a poor first investment without a representative labeled dataset and a demonstrated failure of existing approaches.

## 4. Validation, revisions, transactions, and undo

Run the same command executor for every AI provider. Only it can mutate canonical notebook state.

1. **Parse:** detect refusal, empty result, malformed JSON, truncated stream, or unexpected result channel. Reasoning traces are not lesson content.
2. **Structural validation:** reject unknown fields/operations, excessive content, unsupported types, NaN/infinite geometry, malformed LaTeX, invalid choice IDs, duplicate references, and dangling graph edges.
3. **Scope validation:** verify source and target page, allowlisted object IDs, and operation permissions against the app-captured envelope. Ignore any model claim that it has permission to edit a different notebook.
4. **Revision validation:** compare referenced objects against captured revisions. A concurrent edit to the selected equation invalidates a correctness check or overwrite. A new unrelated pen stroke elsewhere should not invalidate an insertion.
5. **Dry-run layout:** allocate real object IDs, measure text/equations, calculate graph positions and edge bindings, and locate available space. Treat allocation as deterministic for this operation.
6. **Commit:** atomically apply the complete validated changes and an operation record. A failure cannot leave half a diagram or an answer key without its question.
7. **Persist and acknowledge:** record the applied operation and actual object IDs. Retried client delivery returns the existing result, without duplicating shapes.

Use an app-generated `requestId` and a stable `operationId` for deduplication. Retries of the same generation/delivery reuse its identity; a user deliberately selecting Regenerate starts a new operation. Do not rely on a provider's idempotency behavior for canvas deduplication.

For insertion, the source's content revision still matters: an explanation of an equation that changed during inference should be marked stale or regenerated. If only geometry changed, the app may place new content relative to the anchor's current position after a validated re-layout. Define these rules explicitly; a single whole-page revision would cause needless conflicts while the learner writes elsewhere.

Undo is easy only if committed changes are truly local transactions. Do not open an editor history group before awaiting a model response: that risks including the learner's intervening handwriting. Create an undo boundary immediately around the final atomic apply. Initially keep streaming output outside saved state, then commit the completed section once. If later committing several sections progressively, each section should have its own history transaction; do not blindly rewind a shared history stack to remove a lesson after the user has annotated it.

A dedicated “Remove generated section” action can remove only objects still owned by the operation. If the learner changed them, preserve those edits or show the affected objects before removal. Test undo/redo with a learner writing during generation and moving a generated diagram afterward.

Treat note text, pasted instructions, imported material, and image text as **study data**. They cannot expand the model's available commands. Render text through known components; disallow generated scripts, arbitrary HTML, arbitrary external URLs, or resource fetches. This also simplifies a later open-source security review.

## 5. Deterministic lesson layout and streaming

The output contract should express reading order and relationships. The frontend should choose coordinates, font sizes, margins, and a placement region. Use a small lesson frame with vertical sections, comfortable annotation space, and predefined block variants for explanations, worked examples, equations, graphs, and quizzes.

Prefer content measurement over fixed height guesses. Render/measure math with the same local renderer used on the canvas. Use a graph layout package for graph semantics; emit editable node/connector primitives through the canvas adapter. Preserve manual node moves; only re-layout a selected diagram when requested.

The key latency metric is **time until the learner sees useful, readable content**, not first token. Streaming fragments of a 10 KB JSON object directly into saved canvas state is fragile.

Suggested progression:

- First version: one bounded section per request. Show a drafting indicator or nonpersistent preview as text arrives. Once complete and validated, commit the section in one transaction.
- Next version: a brief lesson outline plus an on-demand “Continue” action. Generate the next section using prior section summaries and the learner's question. This reduces oversized lessons and makes interruption natural.
- Only if latency testing warrants it: stream independently validated complete blocks into a draft scene. Never execute partial tool-argument deltas. On failure, preserve the original notebook and offer retry for the unfinished draft.

The AI should not continually pan the learner's viewport. Insert near the requested anchor or into the active lesson frame and offer “Go to explanation.” Keep pen input active during the request. Distinguish “cancel generation” from “remove the already accepted section.”

Initial product limits, to tune after measurement: 8 content blocks per section, 20 diagram nodes, 30 edges, 5 quiz items, and at most one schema repair request. Most lessons should use fewer than these caps. A lesson outline should not trigger dozens of automatic model calls.

## 6. Tutoring, quiz validity, and learning state

Use a few explicit learning actions rather than a vague universal tutor prompt:

- **Explain:** concise concept explanation, a concrete example, and optionally a check-for-understanding question.
- **Hint:** help with the next step while preserving the opportunity to solve it.
- **Worked example:** complete solution when requested, including assumptions and intermediate equations.
- **Check:** explain what was checked, use the selected source snapshot, identify uncertainty, and avoid equating plausibility with proof.
- **Teach:** a small learning objective, explanation, example, diagram if helpful, and one practice question.

For quizzes, generate question, choice IDs/text, exactly one correct choice for a single-answer MCQ, rationale, concept IDs, and source references together. Validate at least two distinct plausible choices, a present correct ID, and no duplicate choice text. Grade selected answers locally. Model generation cost must not recur on each click. Save attempts separately from the question; editing a question produces a new question revision so previous attempts remain interpretable.

Stored answers make instant checking possible but do not guarantee those answers are correct. Review quiz fixtures against a trusted reference. For mathematical equivalence, later add a small deterministic checker with explicit expression grammar and domain assumptions; never run arbitrary model-generated code to check a student's work. Equivalent expressions can differ on excluded domains, so symbolic simplification alone is not a universal correctness test.

For source-based explanation and quiz generation, each important claim should be supported by supplied source IDs; validate that references exist. A valid source ID still does not prove its passage supports a claim, so the evaluation must also score citation support. For general teaching without source material, label it as a generated explanation and do not fabricate sources. If requested information is absent from the supplied notes, say that or ask for the missing context.

Avoid the precise mastery percentages in the initial idea. First store **evidence**: correct/incorrect attempts, independent attempts versus hints, question/concept IDs, question difficulty label, and time. Display “3 of 4 recent questions correct” or “Needs review” rather than an unvalidated claim that a student knows a subject 90%. Asking for an explanation is not proof of misunderstanding. Updating a progress record is local code, not a model decision.

There is encouraging research for AI tutoring support, but it does not establish that this canvas design improves learning. Tutor CoPilot's randomized study supported human tutors and found benefits alongside problems such as inappropriate grade level; it was not a trial of an autonomous notebook. The applicable design lesson is to evaluate pedagogical behavior and learner outcomes, not assume that generated content creates understanding. [Tutor CoPilot paper](https://arxiv.org/abs/2410.03017).

## 7. Evaluation plan before choosing the default model

Keep application invariant tests separate from live model quality evaluation. The former should run without paid/limited inference. The latter should use fixed anonymized or synthetic study materials, with permission for any personal handwriting retained as fixtures.

### Deterministic tests

- Invalid schema, unknown operation, missing target, stale revision, oversized output, invalid graph edge, and bad quiz key all leave state unchanged.
- One valid insertion produces one history step; undo restores the exact previous objects and redo restores the insertion.
- Duplicate delivery and network retry do not duplicate objects or attempts.
- User writing while a request is pending survives commit and undo.
- Cancelled or truncated generation never becomes a committed half-lesson.
- Native-tool arguments split across multiple stream chunks reconstruct correctly; reasoning-only output and unexpected finish status are handled.
- A forged object ID, prompt injection in notes, or a request to modify another page cannot leave the allowed scope.
- Long equations, long labels, Unicode text, narrow viewport, and dense diagram fixtures remain legible and editable.
- Offline notebook use and offline MCQ grading produce zero provider requests.

### Initial live evaluation set

Prepare roughly 60 representative tasks as a starting dataset, with a smaller separate holdout that is not used for prompt tuning:

| Category | Suggested fixtures | What to score |
|---|---|---|
| Text explanations | 12 selections from subjects actually studied | Factual correctness, level, direct relevance, unnecessary content. |
| Editable diagrams | 10 directed graphs/concept maps | Correct nodes/relations, labels, references, readable layout. |
| Quizzes | 10 requests producing several items | Correct answer, ambiguity, plausible distractors, evidence support. |
| Handwriting/math crops | 12 clean, messy, mixed ink/text selections | Transcription fidelity, sign/symbol errors, uncertainty handling. |
| Context/source tasks | 8 missing-context, conflicting-note, and grounded requests | Faithfulness, valid citations, refusal to invent missing evidence. |
| Robustness/adversarial tasks | 8 stale state, instructions embedded in notes, excessive-output requests | Correctly bounded behavior and safe application result. |

Review content manually against answer keys and sources. A second model may help identify potential errors, but should not be the sole correctness oracle. Compare model configurations on identical prompts and record schema success before repair, success after one repair, latency distribution, input/output tokens, and actual billed token use and estimated cost.

Initial release targets should be clearly identified as targets, not measured facts: every invalid-operation fixture must be rejected; zero scope escapes or notebook data-loss cases; at least 95% first-attempt schema validity on the live task set; no critical factual or answer-key errors in reviewed release examples; a useful explanation should usually appear within a tolerable latency established on the real account. Report raw counts and uncertainty instead of treating a 60-task suite as universal accuracy proof.

A simple fixture runner with saved inputs, references, model outputs, validators, and scoring is enough initially. Export results in ordinary JSON/CSV so a larger evaluation framework can be added later without changing the application.

## 8. Build sequence and concrete completion criteria

1. **DeepSeek capability spike:** synthetic inputs only; produce a checked-in capability report with model IDs, supported fields, example valid proposal, stream handling, and latency samples. Test the current Flash model with non-thinking strict tool proposals, the standard JSON fallback, and selected images. Compare Pro only if needed for text quality. Record account access and current model mapping.
2. **Domain schemas and fake AI:** define lesson blocks, semantic graph, MCQ, request envelope, and proposal validator. Render saved fixtures into an existing canvas, fully editable and undoable, before a live model is involved.
3. **Context capture:** implement selected object serialization and optional crop rendering. Show and test exactly what leaves the notebook. No full-notebook retrieval yet.
4. **First vertical slice:** select typed notes, request explanation through the direct DeepSeek API, preview, validate, lay out, commit, save, reopen, undo. Failure and cancellation preserve notes.
5. **Teaching and diagrams:** add bounded lesson sections, equations, graph layout, semantic bindings, manual edits, and source links. Prevent overlap and keep annotation space.
6. **Quizzes:** generate and validate complete questions, local answer checking, persisted attempt records, simple evidence-based progress. No predictive mastery model.
7. **Vision experiment:** selected handwritten notes and equations, editable transcription, source-stroke retention, ambiguity states. Promote only if actual-device tests pass.
8. **Open-source hardening:** mock mode, contribution examples for a tool/shape/provider, documented schemas, safe defaults, retry/cost controls, and regression fixtures. Keep all generated lesson formats usable after changing models.

The original two-week schedule can demonstrate a narrow typed-note-to-AI-section interaction if the canvas already works. Reliable handwriting, robust streaming/history, editable diagrams, interactive quiz cards, and model evaluation should be treated as separate completion gates, not all assumed finished by day fourteen.

## Remaining unknowns to resolve during implementation

- Does the user's DeepSeek account expose the configured current models and beta strict endpoint, with a suitable balance and usage budget?
- Does the beta strict tool path pass the actual command schema and live reliability tests, or should the first release use the standard JSON-output fallback with bounded repair?
- Which candidate is most reliable on the user's subjects, language, and actual handwriting?
- What does the chosen canvas engine permit for grouped history, custom interactive cards, semantic connector bindings, and export?
- How much latency is acceptable while writing on the real target tablet/browser?

None of these requires implementing an autonomous observer or building an LLM/handwriting model from scratch. The proposed boundaries let those answers change while preserving the notebook and its editable learning content.
