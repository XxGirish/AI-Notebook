import type { CanvasProposal } from "@ai-notebook/ai-contract";
import { describe, expect, it } from "vitest";
import { caseById } from "./cases";
import { pageById } from "./pages";
import { describeResult, renderReport } from "./report";
import { errorCounts, findingCounts, median, rejectionCounts, tally, tallyByIntent, type CaseResult, type EvalRun } from "./results";
import { scoreProposal } from "./score";

const proposal: CanvasProposal = {
  schemaVersion: 1,
  operations: [{
    type: "insert_explanation",
    localId: "why",
    anchor: { relation: "below_selection" },
    content: { kind: "text", title: "Why squared", body: "Energy rises with the square of speed, and the brakes have to shed all of it over the distance available." },
  }],
};

const result = (overrides: Partial<CaseResult> = {}): CaseResult => ({
  caseId: "braking-explain",
  pageId: "page-braking",
  intent: "explain_selection",
  note: "Explain one selected item.",
  manualReview: false,
  attempts: [{ index: 0, accepted: true, errors: [], outputCharacters: 420 }],
  droppedContextItems: 0,
  latencyMs: 2_400,
  calls: 1,
  repairAttempts: 0,
  usage: { promptTokens: 2_000, completionTokens: 300, cachedPromptTokens: 1_000 },
  outcome: "proposal",
  proposal,
  score: scoreProposal({ evalCase: caseById("braking-explain"), proposal, context: pageById("page-braking").objects }),
  ...overrides,
});

const run = (results: CaseResult[]): EvalRun => ({
  label: "test",
  startedAt: "2026-09-22T09:00:00.000Z",
  finishedAt: "2026-09-22T09:05:00.000Z",
  provider: "mock",
  model: "deterministic-fixture",
  configurationId: "mock-v1",
  mode: "fixture",
  results,
});

describe("median", () => {
  it("averages the middle pair for an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("is zero for no values", () => {
    expect(median([])).toBe(0);
  });
});

describe("tally", () => {
  it("separates first-attempt success from success after a repair", () => {
    const counted = tally([result(), result({ caseId: "b", repairAttempts: 1 }), result({ caseId: "c", outcome: "error", errorCode: "invalid_proposal", proposal: undefined, score: undefined })]);
    expect(counted).toMatchObject({ cases: 3, valid: 2, validFirstAttempt: 1, validAfterRepair: 1, failed: 1 });
  });

  it("adds up tokens across cases", () => {
    expect(tally([result(), result({ caseId: "b" })])).toMatchObject({ promptTokens: 4_000, completionTokens: 600, cachedPromptTokens: 2_000 });
  });
});

describe("tallyByIntent", () => {
  it("groups by intent", () => {
    const grouped = tallyByIntent([result(), result({ caseId: "t", intent: "teach_section" })]);
    expect(grouped.map((entry) => entry.intent).sort()).toEqual(["explain_selection", "teach_section"]);
  });
});

describe("findingCounts and errorCounts", () => {
  it("counts findings by code, most frequent first", () => {
    const withFinding = result({
      caseId: "f",
      score: { metrics: result().score!.metrics, findings: [{ code: "teach_restates_page", detail: "d", severity: "defect" }], clean: false },
    });
    expect(findingCounts([withFinding, withFinding])).toEqual([{ code: "teach_restates_page", severity: "defect", count: 2 }]);
  });

  it("counts failures by error code", () => {
    expect(errorCounts([result({ outcome: "error", errorCode: "timeout", proposal: undefined, score: undefined })])).toEqual([{ code: "timeout", count: 1 }]);
  });
});

describe("rejectionCounts", () => {
  const rejected = (caseId: string, errors: string[]) =>
    result({ caseId, outcome: "error", errorCode: "invalid_proposal", proposal: undefined, score: undefined, attempts: [{ index: 0, accepted: false, errors, outputCharacters: 300 }] });

  it("groups the same complaint across cases, masking the identifiers that differ", () => {
    const counted = rejectionCounts([
      rejected("a", ["operations.0.content.nodes.3.localId: Duplicate diagram node: step3"]),
      rejected("b", ["operations.0.content.nodes.5.localId: Duplicate diagram node: step7"]),
    ]);
    expect(counted).toHaveLength(1);
    expect(counted[0].count).toBe(2);
    expect(counted[0].cases).toEqual(["a", "b"]);
  });

  it("includes attempts that a later repair rescued", () => {
    const rescued = result({
      caseId: "c",
      repairAttempts: 1,
      attempts: [
        { index: 0, accepted: false, errors: ["operations: Too big: expected array to have <=1 items"], outputCharacters: 900 },
        { index: 1, accepted: true, errors: [], outputCharacters: 700 },
      ],
    });
    expect(rejectionCounts([rescued])).toHaveLength(1);
  });

  it("is empty when nothing was rejected", () => {
    expect(rejectionCounts([result()])).toEqual([]);
  });
});

describe("renderReport", () => {
  it("states the configuration, so a report cannot be mistaken for another prompt's", () => {
    expect(renderReport(run([result()]))).toContain("mock-v1");
  });

  it("lists every case and prints the content of flagged ones", () => {
    const flagged = result({
      caseId: "braking-teach-page",
      intent: "teach_section",
      manualReview: true,
    });
    const report = renderReport(run([result(), flagged]));
    expect(report).toContain("`braking-explain`");
    expect(report).toContain("## Content to read");
    expect(report).toContain("Energy rises with the square of speed");
  });

  it("reports a failed case by its error code", () => {
    const report = renderReport(run([result({ outcome: "error", errorCode: "invalid_proposal", errorMessage: "could not be turned into valid content", proposal: undefined, score: undefined })]));
    expect(report).toContain("## Failures");
    expect(report).toContain("`invalid_proposal`");
  });
});

describe("describeResult", () => {
  it("summarises a success in one line", () => {
    expect(describeResult(result())).toContain("valid overlap=");
  });

  it("names the error code on failure", () => {
    expect(describeResult(result({ outcome: "error", errorCode: "timeout" }))).toContain("FAILED timeout");
  });
});
