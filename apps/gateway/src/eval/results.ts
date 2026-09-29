import type { AiIntent, CanvasProposal, GatewayErrorCode, UsageReport } from "@ai-notebook/ai-contract";
import type { CaseScore, Finding } from "./score";

export type AttemptRecord = {
  index: number;
  accepted: boolean;
  /** The validator's own reasons, so a failure rate can be acted on. */
  errors: string[];
  outputCharacters: number;
  /**
   * Kept only for rejected attempts, and capped. An accepted answer is already
   * in the proposal; a rejected one is unreadable without the text that caused
   * the rejection.
   */
  rejectedOutput?: string;
};

export type CaseResult = {
  caseId: string;
  pageId: string;
  intent: AiIntent;
  note: string;
  manualReview: boolean;
  attempts: AttemptRecord[];
  /** Context items the size budget forced out of the request, as in the browser. */
  droppedContextItems: number;
  latencyMs: number;
  calls: number;
  repairAttempts: number;
  usage: UsageReport;
  outcome: "proposal" | "error";
  errorCode?: GatewayErrorCode;
  errorMessage?: string;
  proposal?: CanvasProposal;
  score?: CaseScore;
};

export type EvalRun = {
  label: string;
  startedAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  /** Carries the prompt version, so a report cannot be mistaken for another prompt's. */
  configurationId: string;
  mode: string;
  results: CaseResult[];
};

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export const mean = (values: number[]): number => (values.length === 0 ? 0 : sum(values) / values.length);

export type Tally = {
  cases: number;
  valid: number;
  validFirstAttempt: number;
  validAfterRepair: number;
  failed: number;
  /** Valid and free of defects: the figure that matters for everyday use. */
  clean: number;
  medianLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
};

export function tally(results: CaseResult[]): Tally {
  const valid = results.filter((result) => result.outcome === "proposal");
  return {
    cases: results.length,
    valid: valid.length,
    validFirstAttempt: valid.filter((result) => result.repairAttempts === 0).length,
    validAfterRepair: valid.filter((result) => result.repairAttempts > 0).length,
    failed: results.length - valid.length,
    clean: valid.filter((result) => result.score?.clean).length,
    medianLatencyMs: Math.round(median(results.map((result) => result.latencyMs))),
    promptTokens: sum(results.map((result) => result.usage.promptTokens ?? 0)),
    completionTokens: sum(results.map((result) => result.usage.completionTokens ?? 0)),
    cachedPromptTokens: sum(results.map((result) => result.usage.cachedPromptTokens ?? 0)),
  };
}

export function tallyByIntent(results: CaseResult[]): Array<{ intent: AiIntent; tally: Tally }> {
  const intents = [...new Set(results.map((result) => result.intent))];
  return intents.map((intent) => ({ intent, tally: tally(results.filter((result) => result.intent === intent)) }));
}

export function findingCounts(results: CaseResult[]): Array<{ code: string; severity: Finding["severity"]; count: number }> {
  const counts = new Map<string, { code: string; severity: Finding["severity"]; count: number }>();
  for (const result of results) {
    for (const finding of result.score?.findings ?? []) {
      const existing = counts.get(finding.code);
      if (existing) existing.count += 1;
      else counts.set(finding.code, { code: finding.code, severity: finding.severity, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * Rejection reasons across every attempt, including attempts a later repair
 * rescued. A reason that keeps recurring is a prompt or schema problem, not bad
 * luck, which is the distinction a failure count alone cannot make.
 */
export function rejectionCounts(results: CaseResult[]): Array<{ reason: string; count: number; cases: string[] }> {
  const counts = new Map<string, { reason: string; count: number; cases: Set<string> }>();
  for (const result of results) {
    // A run recorded before `attempts` existed has none. Reports must stay
    // readable across stored runs, or old runs cannot be compared with new ones.
    for (const attempt of result.attempts ?? []) {
      for (const error of attempt.errors) {
        // Identifiers and counts vary per answer; the shape of the complaint does not.
        const reason = error.replaceAll(/\b[a-z0-9_-]*\d[a-z0-9_-]*\b/gi, "*").replaceAll(/\s+/g, " ").trim();
        const existing = counts.get(reason);
        if (existing) {
          existing.count += 1;
          existing.cases.add(result.caseId);
        } else {
          counts.set(reason, { reason, count: 1, cases: new Set([result.caseId]) });
        }
      }
    }
  }
  return [...counts.values()]
    .map((entry) => ({ reason: entry.reason, count: entry.count, cases: [...entry.cases] }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function errorCounts(results: CaseResult[]): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.outcome !== "error") continue;
    const code = result.errorCode ?? "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}
