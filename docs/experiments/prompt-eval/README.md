# Prompt evaluation

A recorded prompt set and a runner that measures what the gateway's prompt
actually produces. It exists because four requests on one page settled that the
wiring works but said nothing about quality, and because Phase 3's exit evidence
asks for a recorded set covering explanations, equations, graphs, quizzes and
adversarial cases.

## Running it

From the repository root:

```bash
npm run eval --workspace @ai-notebook/gateway -- --dry-run
```

`--dry-run` builds every request and prints its size without calling a provider.
Use it after changing a fixture: a case that breaks a contract ceiling fails here
instead of halfway through a paid run.

```bash
npm run eval --workspace @ai-notebook/gateway -- --provider mock --label wiring
```

The mock provider needs no credentials and no network, so this is the form that
belongs in CI. It proves the harness and the report, not the model.

```bash
npm run eval --workspace @ai-notebook/gateway -- --provider deepseek --label v2-candidate --token-budget 400000
```

A live run reads `apps/gateway/.env` exactly as the server does. It is sequential
and paced, because the gateway itself permits one generation at a time, and it
stops once `--token-budget` prompt plus completion tokens have been spent.

Useful narrowing flags: `--case braking` (substring match on case id),
`--intent create_quiz`, `--page page-bayes`, `--max-cases 5`, `--delay 2000`,
`--out <dir>`. `--output-mode strict_tool|json_object` overrides the configured
DeepSeek output mode, so the two can be compared on one case set.

```bash
npm run eval --workspace @ai-notebook/gateway -- --rescore docs/experiments/prompt-eval/<run>.json
```

Scores a stored run again with the current checks and writes a new report beside
it. Use it whenever a measure changes: a flaw found after a paid run should not
mean paying for the run twice, and two runs are only comparable when the same
checks were applied to both. Reports name the provider configuration, which
carries the prompt version, so the pair cannot be confused.

## What it measures

Validity is decided by the same validator the gateway uses, through the same
`runGeneration` path, so "valid" here means "would have committed to a page".
The runner calls that function directly rather than the HTTP surface, so the
single-flight lock and the per-minute window do not distort the numbers.

On top of validity:

| Measure | Question it answers |
| --- | --- |
| `contextOverlap` | What fraction of the new text is phrasing already on the page? |
| `maxSentenceEcho` | Is any generated sentence a restatement of one on the page? |
| `selfRepetition` | Does the answer say the same thing twice? |
| `quiz_echoes_page` | Was the page's own question handed back as new work? |
| `quiz_*` | Duplicate options, too few options, a rationale that never mentions its answer, the longest option being correct. |
| `diagram_*` | Nodes connected to nothing, unlabelled relationships, more nodes than the task asked for. |
| `injected_text_reproduced` | Did instruction text inside a note reach the output? |

The overlap thresholds are applied only to `teach_section`, because that is the
intent that has to add to a page; restating a definition inside an explanation is
often the right thing to do. Numbers are recorded for every intent regardless.

**The thresholds in `score.ts` are provisional.** They were set near the measured
baseline so that a prompt change shows up as movement. They are not a validated
quality bar, and a decision record should say which run a threshold came from.

## What it does not measure

Whether the content is *correct*. A well-formed question with a wrong answer key
scores clean. The report therefore prints the generated content for every case
marked for review and every case with a finding, and the release gate in
`AGENTS.md` still calls for reading at least 50 generated questions by hand.

## Fixtures

`apps/gateway/src/eval/pages.ts` holds the notebook pages. Every word is written
for this repository: no private notebook content and no copied course material,
so the set can ship with the open-source release. Eight subject pages carry
material worth extending; six adversarial pages carry notes that try to issue
instructions, a page with three words on it, a confident factual error, a note
near the size ceiling, and noise.

`apps/gateway/src/eval/cases.ts` turns those pages into requests. It orders
context the way the browser does — selection first — and applies the action plans
from the shared contract rather than a copy of them, so a change to what an
action permits cannot leave the evaluation testing something else.

## Reports

Each run writes `<timestamp>-<label>.md` and `.json` here. The Markdown is for
reading; the JSON holds every proposal in full, so two runs can be compared
without rerunning either. Both name the provider configuration, which includes
the prompt version, so a report cannot be mistaken for another prompt's.
