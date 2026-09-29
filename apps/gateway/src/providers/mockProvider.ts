import { mockLessonProposal, type GenerateRequest } from "@ai-notebook/ai-contract";
import { ProviderError, type AiProvider, type ChatCall, type ChatResult, type ProviderCall, type ProviderResult } from "./types";

type MockProviderOptions = {
  /** Scripted raw outputs returned in order; used to exercise repair and failure paths. */
  script?: Array<string | ProviderError>;
  /** Scripted chat answers returned in order; each is streamed in small pieces. */
  chatScript?: Array<string | ProviderError>;
  delayMs?: number;
};

/**
 * A deterministic, network-free provider. It lets the notebook, gateway, and
 * contribution workflow run without a DeepSeek account or paid credentials.
 */
export class MockProvider implements AiProvider {
  readonly id = "mock";
  readonly model = "deterministic-fixture";
  readonly mode = "fixture";
  readonly configurationId = "mock-v1";
  readonly chatConfigurationId = "mock-chat-v1";
  private readonly script: Array<string | ProviderError>;
  private readonly chatScript: Array<string | ProviderError>;

  constructor(private readonly options: MockProviderOptions = {}) {
    this.script = [...(options.script ?? [])];
    this.chatScript = [...(options.chatScript ?? [])];
  }

  async chat({ request, signal, onDelta }: ChatCall): Promise<ChatResult> {
    if (this.options.delayMs) await abortableDelay(this.options.delayMs, signal);
    if (signal.aborted) throw new ProviderError("cancelled", "The answer was cancelled", false);
    const scripted = this.chatScript.shift();
    if (scripted instanceof ProviderError) throw scripted;
    const first = request.passages[0];
    const answer = scripted ?? (first
      ? `This is a deterministic mock answer. Your sources discuss this in ${first.origin} [${first.id}]. Connect a live provider for real answers.`
      : "This is a deterministic mock answer. No passages from your sources matched the question. Connect a live provider for real answers.");
    // Streamed in pieces so the panel's incremental rendering is exercised without a network.
    for (const piece of answer.match(/.{1,24}/gs) ?? []) {
      if (signal.aborted) throw new ProviderError("cancelled", "The answer was cancelled", false);
      await onDelta(piece);
    }
    return { usage: { promptTokens: 0, completionTokens: 0 } };
  }

  async generate({ request, signal }: ProviderCall): Promise<ProviderResult> {
    if (this.options.delayMs) await abortableDelay(this.options.delayMs, signal);
    if (signal.aborted) throw new ProviderError("cancelled", "Generation was cancelled", false);
    const scripted = this.script.shift();
    if (scripted instanceof ProviderError) throw scripted;
    const text = scripted ?? JSON.stringify(fixtureFor(request));
    return { text, protocolIssues: [], usage: { promptTokens: 0, completionTokens: 0 } };
  }
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function firstContextTitle(request: GenerateRequest) {
  const item = request.context[0];
  if (!item) return "the selection";
  if (item.kind === "text" || item.kind === "equation") return item.title || "the selection";
  if (item.kind === "quiz") return "this question";
  return item.nodes[0]?.label ?? "this diagram";
}

function fixtureFor(request: GenerateRequest): unknown {
  const topic = firstContextTitle(request);
  switch (request.intent) {
    case "teach_section":
      return mockLessonProposal;
    case "explain_selection":
      return { schemaVersion: 1, operations: [{
        type: "insert_explanation",
        localId: "explanation",
        anchor: { relation: "below_selection" },
        content: { kind: "text", title: `About ${topic}`.slice(0, 160), body: "This is a deterministic mock explanation. Connect a live provider to generate real teaching content." },
      }] };
    case "create_diagram":
      return { schemaVersion: 1, operations: [{
        type: "insert_diagram",
        localId: "diagram",
        anchor: { relation: "right_of_selection" },
        content: {
          kind: "diagram",
          title: `Map of ${topic}`.slice(0, 160),
          direction: "left_to_right",
          nodes: [{ localId: "idea", label: "Idea" }, { localId: "example", label: "Example" }, { localId: "check", label: "Check" }],
          edges: [{ from: "idea", to: "example", label: "illustrated by" }, { from: "example", to: "check" }],
        },
      }] };
    case "create_equation":
      return { schemaVersion: 1, operations: [{
        type: "insert_equation",
        localId: "equation",
        anchor: { relation: "below_selection" },
        content: { kind: "equation", title: "Average velocity", latex: "\\bar{v} = \\frac{\\Delta x}{\\Delta t}", explanation: "Displacement divided by elapsed time." },
      }] };
    case "create_quiz":
      return { schemaVersion: 1, operations: [{
        type: "insert_quiz",
        localId: "quiz",
        anchor: { relation: "below_selection" },
        content: {
          kind: "quiz",
          prompt: `Which statement best describes ${topic}?`.slice(0, 1_500),
          options: [{ localId: "a", label: "A mock correct answer" }, { localId: "b", label: "A mock distractor" }, { localId: "c", label: "Another mock distractor" }],
          correctOptionLocalId: "a",
          rationale: "Mock quizzes mark the first option correct so local grading can be exercised.",
          conceptTags: ["mock"],
        },
      }] };
  }
}
