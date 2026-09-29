import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GenerateRequestSchema, type GatewayEvent, type UsageReport } from "@ai-notebook/ai-contract";
import { ConfigError, loadConfig } from "../config";
import { runGeneration } from "../generation";
import { DeepSeekProvider } from "../providers/deepseek/deepseekProvider";
import { MockProvider } from "../providers/mockProvider";
import type { AiProvider } from "../providers/types";
import { buildEvalRequest, caseById, EVAL_CASES, type EvalCase } from "./cases";
import { describeResult, renderReport } from "./report";
import type { CaseResult, EvalRun } from "./results";
import { scoreProposal } from "./score";

/**
 * Runs the recorded prompt set through the real prompt, provider and validator.
 *
 * It calls `runGeneration` directly rather than the HTTP surface, so the
 * gateway's single-flight lock and per-minute window do not distort the run.
 * Everything the model sees and every check applied to its answer is therefore
 * the same code the application uses; only the transport differs. The run stays
 * sequential and paced for the same reason the gateway allows one request at a
 * time.
 *
 *   npm run eval --workspace @ai-notebook/gateway -- --dry-run
 *   npm run eval --workspace @ai-notebook/gateway -- --provider deepseek --label v1-baseline
 */

type Options = {
  provider?: "mock" | "deepseek";
  /** Overrides DEEPSEEK_OUTPUT_MODE, so the two output modes can be compared on one case set. */
  outputMode?: "strict_tool" | "json_object";
  label?: string;
  outDir: string;
  dryRun: boolean;
  /** A stored run to score again with the current checks, instead of calling a provider. */
  rescore?: string;
  delayMs?: number;
  maxCases?: number;
  /** Stops the run once this many prompt+completion tokens have been spent. */
  tokenBudget: number;
  filterCases?: string[];
  filterIntents?: string[];
  filterPages?: string[];
};

function parseArgs(argv: string[]): Options {
  const options: Options = { outDir: join("..", "..", "docs", "experiments", "prompt-eval"), dryRun: false, tokenBudget: 1_000_000 };
  const list = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--dry-run": options.dryRun = true; break;
      case "--rescore": options.rescore = next(); break;
      case "--provider": {
        const value = next();
        if (value !== "mock" && value !== "deepseek") throw new Error("--provider must be mock or deepseek");
        options.provider = value;
        break;
      }
      case "--output-mode": {
        const value = next();
        if (value !== "strict_tool" && value !== "json_object") throw new Error("--output-mode must be strict_tool or json_object");
        options.outputMode = value;
        break;
      }
      case "--label": options.label = next(); break;
      case "--out": options.outDir = next(); break;
      case "--delay": options.delayMs = Number(next()); break;
      case "--max-cases": options.maxCases = Number(next()); break;
      case "--token-budget": options.tokenBudget = Number(next()); break;
      case "--case": options.filterCases = list(next()); break;
      case "--intent": options.filterIntents = list(next()); break;
      case "--page": options.filterPages = list(next()); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function selectCases(options: Options): EvalCase[] {
  let cases = EVAL_CASES;
  if (options.filterCases) cases = cases.filter((item) => options.filterCases!.some((pattern) => item.id.includes(pattern)));
  if (options.filterIntents) cases = cases.filter((item) => options.filterIntents!.includes(item.intent));
  if (options.filterPages) cases = cases.filter((item) => options.filterPages!.some((pattern) => item.pageId.includes(pattern)));
  return options.maxCases ? cases.slice(0, options.maxCases) : cases;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Enough of a rejected answer to see what went wrong, without storing whole transcripts. */
const MAX_KEPT_REJECTED_OUTPUT = 4_000;

const spent = (usage: UsageReport) => (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);

async function runCase(evalCase: EvalCase, provider: AiProvider, runToken: string, timeoutMs: number): Promise<CaseResult> {
  const requestId = `${evalCase.id}-${runToken}`.replaceAll(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
  const built = buildEvalRequest(evalCase, requestId);
  const parsed = GenerateRequestSchema.safeParse(built.request);
  if (!parsed.success) throw new Error(`Case ${evalCase.id} built an invalid request: ${parsed.error.issues[0].message}`);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const base = {
    caseId: evalCase.id,
    pageId: evalCase.pageId,
    intent: evalCase.intent,
    note: evalCase.note,
    manualReview: evalCase.manualReview ?? false,
    droppedContextItems: built.droppedContextItems,
  };

  let proposal: CaseResult["proposal"];
  let errorMessage: string | undefined;
  const attempts: CaseResult["attempts"] = [];
  const startedAt = performance.now();
  try {
    const outcome = await runGeneration({
      request: built.request,
      provider,
      signal: controller.signal,
      timedOut: () => timedOut,
      emit: (event: GatewayEvent) => {
        if (event.type === "proposal") proposal = event.proposal;
        if (event.type === "error") errorMessage = event.message;
      },
      onAttempt: ({ output, ...attempt }) =>
        attempts.push(attempt.accepted ? attempt : { ...attempt, rejectedOutput: output.slice(0, MAX_KEPT_REJECTED_OUTPUT) }),
    });
    const latencyMs = performance.now() - startedAt;
    const score = proposal ? scoreProposal({ evalCase, proposal, context: built.request.context }) : undefined;
    return {
      ...base,
      attempts,
      latencyMs,
      calls: outcome.calls,
      repairAttempts: outcome.repairAttempts,
      usage: outcome.usage,
      outcome: outcome.outcome,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(proposal ? { proposal } : {}),
      ...(score ? { score } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeRequests(cases: EvalCase[]): void {
  const encoder = new TextEncoder();
  console.info(`${cases.length} cases. No provider was called.`);
  for (const evalCase of cases) {
    const built = buildEvalRequest(evalCase, `${evalCase.id}-dryrun`.slice(0, 100));
    const parsed = GenerateRequestSchema.safeParse(built.request);
    const bytes = encoder.encode(JSON.stringify(built.request)).length;
    const dropped = built.droppedContextItems > 0 ? ` dropped=${built.droppedContextItems}` : "";
    console.info(
      `${parsed.success ? "ok  " : "BAD "} ${evalCase.id.padEnd(30)} ${evalCase.intent.padEnd(18)} items=${built.request.context.length} bytes=${bytes}${dropped}` +
        (parsed.success ? "" : ` :: ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}`),
    );
  }
}

function writeRun(run: EvalRun, outDir: string, stemName: string): void {
  const stem = join(outDir, stemName.replaceAll(/[^A-Za-z0-9_.-]/g, "-"));
  mkdirSync(dirname(stem), { recursive: true });
  writeFileSync(`${stem}.md`, renderReport(run), "utf8");
  writeFileSync(`${stem}.json`, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.info(`\nReport: ${stem}.md`);
  console.info(`Data:   ${stem}.json`);
}

/**
 * Scores a stored run again with the current checks. A measurement flaw found
 * after a paid run should not require paying for the run twice, and two runs
 * are only comparable when the same checks were applied to both.
 */
function rescore(path: string, outDir: string, label?: string): void {
  const stored = JSON.parse(readFileSync(path, "utf8")) as EvalRun;
  const results = stored.results.map((result) => {
    if (!result.proposal) return result;
    const evalCase = caseById(result.caseId);
    const built = buildEvalRequest(evalCase, "rescore00");
    return { ...result, score: scoreProposal({ evalCase, proposal: result.proposal, context: built.request.context }) };
  });
  const rescored: EvalRun = { ...stored, label: label ?? `${stored.label}-rescored`, results };
  console.info(`Scored ${results.length} stored cases again with the current checks. No provider was called.`);
  writeRun(rescored, outDir, `${basename(path, ".json")}-rescored`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.rescore) {
    rescore(options.rescore, options.outDir, options.label);
    return;
  }

  const cases = selectCases(options);
  if (cases.length === 0) throw new Error("No cases matched the filters");

  if (options.dryRun) {
    describeRequests(cases);
    return;
  }

  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = {
    ...process.env,
    ...(options.provider ? { AI_PROVIDER: options.provider } : {}),
    ...(options.outputMode ? { DEEPSEEK_OUTPUT_MODE: options.outputMode } : {}),
  };
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Gateway configuration error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const provider: AiProvider = config.deepseek ? new DeepSeekProvider(config.deepseek) : new MockProvider();
  const pacingMs = options.delayMs ?? (provider.id === "mock" ? 0 : 1_500);
  const runToken = new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
  const label = options.label ?? `${provider.id}-${runToken}`;

  console.info(`Running ${cases.length} cases against ${provider.id} (${provider.model}, ${provider.mode}).`);
  console.info(`Configuration: ${provider.configurationId}`);
  if (provider.id !== "mock") console.info(`Token budget ${options.tokenBudget}, pacing ${pacingMs} ms between cases.`);

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  let tokensSpent = 0;

  for (const [index, evalCase] of cases.entries()) {
    if (tokensSpent > options.tokenBudget) {
      console.warn(`Token budget reached after ${results.length} cases; stopping. Remaining cases are absent from the report.`);
      break;
    }
    const result = await runCase(evalCase, provider, runToken, config.generationTimeoutMs);
    results.push(result);
    tokensSpent += spent(result.usage);
    console.info(`[${index + 1}/${cases.length}] ${describeResult(result)}`);
    if (pacingMs > 0 && index < cases.length - 1) await delay(pacingMs);
  }

  const run: EvalRun = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    provider: provider.id,
    model: provider.model,
    configurationId: provider.configurationId,
    mode: provider.mode,
    results,
  };

  writeRun(run, options.outDir, `${runToken}-${label}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
