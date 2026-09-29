import { AI_INTENTS, AI_REQUEST_PLANS, GenerateRequestSchema, MAX_GENERATE_REQUEST_BYTES } from "@ai-notebook/ai-contract";
import { describe, expect, it } from "vitest";
import { buildEvalRequest, contextToText, EVAL_CASES, orderedContext } from "./cases";
import { ALL_PAGES, pageById } from "./pages";

const encoder = new TextEncoder();

describe("the recorded prompt set", () => {
  it("has unique case ids", () => {
    const ids = EVAL_CASES.map((evalCase) => evalCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers at least 50 prompts, as the release gate requires", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(50);
  });

  it("covers every intent the contract defines", () => {
    const covered = new Set(EVAL_CASES.map((evalCase) => evalCase.intent));
    expect([...covered].sort()).toEqual([...AI_INTENTS].sort());
  });

  it("includes adversarial and malformed cases", () => {
    expect(EVAL_CASES.filter((evalCase) => evalCase.id.startsWith("adv-")).length).toBeGreaterThanOrEqual(8);
  });

  it("names pages and selections that exist", () => {
    for (const evalCase of EVAL_CASES) {
      const page = pageById(evalCase.pageId);
      const ids = page.objects.flatMap((item) => (item.kind === "diagram" ? item.nodes.map((node) => node.id) : [item.id]));
      for (const selected of evalCase.selectedIds) expect(ids, `${evalCase.id} selects ${selected}`).toContain(selected);
    }
  });

  it("selects something for every intent that requires it", () => {
    for (const evalCase of EVAL_CASES) {
      if (!AI_REQUEST_PLANS[evalCase.intent].requiresContext) continue;
      expect(evalCase.selectedIds.length, `${evalCase.id} needs a selection`).toBeGreaterThan(0);
    }
  });
});

describe("the fixture pages", () => {
  it("hold only contract-valid context items", () => {
    // Every page is sent through the request schema, so a fixture that exceeds a
    // contract ceiling fails here rather than halfway through a paid run.
    for (const page of ALL_PAGES) {
      const request = {
        requestId: "fixturecheck",
        pageId: page.id,
        intent: "teach_section" as const,
        permittedOperations: ["insert_lesson_section" as const],
        maxOperations: 1,
        targets: [],
        context: page.objects,
      };
      expect(GenerateRequestSchema.safeParse(request).success, `${page.id} is not contract-valid`).toBe(true);
    }
  });

  it("have unique object ids within a page", () => {
    for (const page of ALL_PAGES) {
      const ids = page.objects.map((item) => item.id);
      expect(new Set(ids).size, `${page.id} repeats an object id`).toBe(ids.length);
    }
  });
});

describe("orderedContext", () => {
  it("puts the selection first, as the browser does", () => {
    const page = pageById("page-braking");
    const ordered = orderedContext(page, ["braking-friction"]);
    expect(ordered[0].id).toBe("braking-friction");
    expect(ordered).toHaveLength(page.objects.length);
  });

  it("keeps page order when nothing is selected", () => {
    const page = pageById("page-braking");
    expect(orderedContext(page, []).map((item) => item.id)).toEqual(page.objects.map((item) => item.id));
  });
});

describe("buildEvalRequest", () => {
  it("builds a contract-valid request for every case", () => {
    for (const evalCase of EVAL_CASES) {
      const built = buildEvalRequest(evalCase, `${evalCase.id}-testrun`.slice(0, 100));
      const parsed = GenerateRequestSchema.safeParse(built.request);
      expect(parsed.success, `${evalCase.id}: ${parsed.success ? "" : parsed.error.issues[0].message}`).toBe(true);
      expect(encoder.encode(JSON.stringify(built.request)).length).toBeLessThanOrEqual(MAX_GENERATE_REQUEST_BYTES);
    }
  });

  it("applies the action's plan rather than a copy of it", () => {
    const built = buildEvalRequest(EVAL_CASES.find((evalCase) => evalCase.intent === "create_quiz")!, "quizcase1");
    expect(built.request.permittedOperations).toEqual(AI_REQUEST_PLANS.create_quiz.permittedOperations);
    expect(built.request.maxOperations).toBe(AI_REQUEST_PLANS.create_quiz.maxOperations);
  });

  it("never permits updates to existing objects", () => {
    for (const evalCase of EVAL_CASES) {
      const built = buildEvalRequest(evalCase, `${evalCase.id}-testrun`.slice(0, 100));
      expect(built.request.permittedOperations).not.toContain("propose_object_update");
      expect(built.request.targets).toEqual([]);
    }
  });

  it("keeps the oversized page within the size budget", () => {
    const built = buildEvalRequest(EVAL_CASES.find((evalCase) => evalCase.id === "adv-oversized-teach")!, "oversized1");
    expect(built.request.context.length).toBeGreaterThan(0);
    expect(encoder.encode(JSON.stringify(built.request)).length).toBeLessThanOrEqual(MAX_GENERATE_REQUEST_BYTES);
  });
});

describe("contextToText", () => {
  it("includes the text a reader would compare against", () => {
    const text = contextToText(pageById("page-braking").objects);
    expect(text).toContain("Stopping distance is thinking distance plus braking distance");
    expect(text).toContain("It quadruples");
  });
});
