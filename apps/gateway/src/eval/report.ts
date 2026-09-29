import { proseBlocks, THRESHOLDS } from "./score";
import { errorCounts, findingCounts, mean, rejectionCounts, tally, tallyByIntent, type CaseResult, type EvalRun } from "./results";

const percent = (part: number, whole: number) => (whole === 0 ? "—" : `${((part / whole) * 100).toFixed(0)}%`);
const number = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
const table = (headers: string[], rows: Array<Array<string | number>>) =>
  [row(headers), row(headers.map(() => "---")), ...rows.map(row)].join("\n");

/**
 * Renders one run as Markdown. Numbers first, then the generated content for the
 * cases whose value is in reading them: a summary that hides the content would
 * make the quality claims unverifiable.
 */
export function renderReport(run: EvalRun): string {
  const overall = tally(run.results);
  const lines: string[] = [];

  lines.push(`# Prompt evaluation — ${run.label}`);
  lines.push("");
  lines.push(`- Run: ${run.startedAt} to ${run.finishedAt}`);
  lines.push(`- Provider: \`${run.provider}\` model \`${run.model}\` mode \`${run.mode}\``);
  lines.push(`- Configuration: \`${run.configurationId}\``);
  lines.push(`- Cases: ${overall.cases}`);
  lines.push("");
  lines.push(
    "Thresholds are provisional; they exist so a prompt change shows up as movement, not as a validated quality bar. " +
      `Overlap budget for teaching ${THRESHOLDS.teachContextOverlap}, sentence echo ${THRESHOLDS.sentenceEcho}, ` +
      `self-repetition ${THRESHOLDS.selfRepetition}, echoed question ${THRESHOLDS.echoedQuiz}.`,
  );
  lines.push("");

  lines.push("## Headline");
  lines.push("");
  lines.push(
    table(
      ["Measure", "Value"],
      [
        ["Valid proposals", `${overall.valid} / ${overall.cases} (${percent(overall.valid, overall.cases)})`],
        ["Valid without repair", `${overall.validFirstAttempt} / ${overall.cases} (${percent(overall.validFirstAttempt, overall.cases)})`],
        ["Needed the one repair", `${overall.validAfterRepair}`],
        ["Valid and free of defects", `${overall.clean} / ${overall.cases} (${percent(overall.clean, overall.cases)})`],
        ["Median latency", `${overall.medianLatencyMs} ms`],
        ["Prompt tokens", overall.promptTokens],
        ["Cached prompt tokens", `${overall.cachedPromptTokens} (${percent(overall.cachedPromptTokens, overall.promptTokens)})`],
        ["Completion tokens", overall.completionTokens],
      ],
    ),
  );
  lines.push("");

  lines.push("## By intent");
  lines.push("");
  lines.push(
    table(
      ["Intent", "Cases", "Valid", "No repair", "Clean", "Median ms", "Mean overlap"],
      tallyByIntent(run.results).map(({ intent, tally: intentTally }) => {
        const overlaps = run.results
          .filter((result) => result.intent === intent && result.score)
          .map((result) => result.score!.metrics.contextOverlap);
        return [
          intent,
          intentTally.cases,
          percent(intentTally.valid, intentTally.cases),
          percent(intentTally.validFirstAttempt, intentTally.cases),
          percent(intentTally.clean, intentTally.cases),
          intentTally.medianLatencyMs,
          overlaps.length > 0 ? number(mean(overlaps)) : "—",
        ];
      }),
    ),
  );
  lines.push("");

  const findings = findingCounts(run.results);
  lines.push("## Findings");
  lines.push("");
  lines.push(
    findings.length === 0
      ? "None."
      : table(["Finding", "Severity", "Cases"], findings.map((finding) => [`\`${finding.code}\``, finding.severity, finding.count])),
  );
  lines.push("");

  const errors = errorCounts(run.results);
  if (errors.length > 0) {
    lines.push("## Failures");
    lines.push("");
    lines.push(table(["Error code", "Cases"], errors.map((error) => [`\`${error.code}\``, error.count])));
    lines.push("");
  }

  const rejections = rejectionCounts(run.results);
  if (rejections.length > 0) {
    lines.push("## Why answers were rejected");
    lines.push("");
    lines.push("Every rejected attempt, including those a repair later rescued. Identifiers are masked so one reason groups.");
    lines.push("");
    lines.push(
      table(
        ["Reason", "Attempts", "Cases"],
        rejections.map((rejection) => [rejection.reason, rejection.count, rejection.cases.slice(0, 6).join(", ") + (rejection.cases.length > 6 ? ", …" : "")]),
      ),
    );
    lines.push("");
  }

  lines.push("## Every case");
  lines.push("");
  lines.push(
    table(
      ["Case", "Intent", "Result", "Repair", "Overlap", "Echo", "Self-rep", "Ops", "ms", "Defects"],
      run.results.map((result) => {
        const metrics = result.score?.metrics;
        const defects = (result.score?.findings ?? []).filter((finding) => finding.severity === "defect");
        return [
          `\`${result.caseId}\``,
          result.intent,
          result.outcome === "proposal" ? "valid" : `\`${result.errorCode ?? "error"}\``,
          result.repairAttempts,
          metrics ? number(metrics.contextOverlap) : "—",
          metrics ? number(metrics.maxSentenceEcho) : "—",
          metrics ? number(metrics.selfRepetition) : "—",
          metrics ? metrics.operations : "—",
          Math.round(result.latencyMs),
          defects.length === 0 ? "" : defects.map((finding) => `\`${finding.code}\``).join(" "),
        ];
      }),
    ),
  );
  lines.push("");

  const detailed = run.results.filter((result) => result.manualReview || (result.score?.findings.length ?? 0) > 0 || result.outcome === "error");
  if (detailed.length > 0) {
    lines.push("## Content to read");
    lines.push("");
    lines.push("Cases flagged for human judgement, plus every case with a finding or a failure.");
    lines.push("");
    for (const result of detailed) {
      lines.push(`### ${result.caseId} — ${result.intent}`);
      lines.push("");
      lines.push(`_${result.note}_`);
      lines.push("");
      for (const finding of result.score?.findings ?? []) {
        lines.push(`- **${finding.severity}** \`${finding.code}\`: ${finding.detail}`);
      }
      if (result.outcome === "error") {
        lines.push(`- **failed** \`${result.errorCode}\`: ${result.errorMessage ?? ""}`);
        for (const attempt of result.attempts ?? []) {
          for (const error of attempt.errors) lines.push(`  - attempt ${attempt.index + 1}: ${error}`);
        }
      }
      lines.push("");
      if (result.proposal) {
        for (const block of proseBlocks(result.proposal)) {
          lines.push("```text");
          lines.push(block);
          lines.push("```");
          lines.push("");
        }
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/** A one-line summary for the terminal while a run is in progress. */
export function describeResult(result: CaseResult): string {
  if (result.outcome === "error") return `${result.caseId}: FAILED ${result.errorCode} (${Math.round(result.latencyMs)} ms)`;
  const metrics = result.score?.metrics;
  const defects = (result.score?.findings ?? []).filter((finding) => finding.severity === "defect").length;
  const repair = result.repairAttempts > 0 ? ` repair=${result.repairAttempts}` : "";
  return `${result.caseId}: valid${repair} overlap=${number(metrics?.contextOverlap ?? 0)} defects=${defects} (${Math.round(result.latencyMs)} ms)`;
}
