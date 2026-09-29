import type { CanvasProposal, ContextItem, LearningPayloadSchema, SemanticOperation } from "@ai-notebook/ai-contract";
import type { z } from "zod";
import { contextToText, type EvalCase } from "./cases";
import { containment, maxPairwiseSimilarity, maxSentenceEcho, similarity, words } from "./text";

type LearningPayload = z.infer<typeof LearningPayloadSchema>;

/**
 * Thresholds the report judges against.
 *
 * PROVISIONAL, and set from a recorded run: `20260922023303-v1-baseline`, 57
 * cases on `canvas-proposal-prompt-v1`. They exist so a prompt change shows up
 * as movement, not to assert a validated quality bar.
 *
 * What that baseline showed: word-level overlap never exceeded 0.05 on real
 * output, so `teachContextOverlap` is a loose guard against wholesale copying
 * rather than the measure that catches restatement. The checks that actually
 * fire on the defect are `quiz_echoes_page`, `equation_already_on_page` and
 * sentence echo.
 */
export const THRESHOLDS = {
  /** Fraction of a teaching section's five-word phrases already on the page. */
  teachContextOverlap: 0.12,
  /** Similarity of the closest generated sentence to a sentence on the page. */
  sentenceEcho: 0.6,
  /** Similarity between two blocks of one generated answer. */
  selfRepetition: 0.5,
  /** Similarity at which a generated question counts as the page's question again. */
  echoedQuiz: 0.5,
  /** The diagram task asks for 2 to 8 nodes; the schema itself permits 16. */
  diagramNodesMax: 8,
  /** The quiz task asks for 3 or 4 options; the schema itself permits 2. */
  quizOptionsMin: 3,
};

export type Finding = {
  code: string;
  detail: string;
  /** A defect fails the case. A warning is recorded and counted, but does not. */
  severity: "defect" | "warning";
};

export type QuizCheck = {
  optionCount: number;
  duplicateOptionLabels: boolean;
  correctIsLongestOption: boolean;
  rationaleReferencesAnswer: boolean;
  promptEchoOfPageQuiz: number;
};

export type DiagramCheck = {
  nodes: number;
  edges: number;
  orphanNodes: number;
  unlabelledEdges: number;
};

export type ProposalMetrics = {
  operations: number;
  blocks: number;
  blockKinds: Record<string, number>;
  generatedCharacters: number;
  /** Fraction of the generated prose's five-word phrases already present in the context. */
  contextOverlap: number;
  maxSentenceEcho: number;
  selfRepetition: number;
  quizzes: QuizCheck[];
  diagrams: DiagramCheck[];
};

export type CaseScore = {
  metrics: ProposalMetrics;
  findings: Finding[];
  /** No defects. Warnings do not clear this flag. */
  clean: boolean;
};

const blocksOf = (operation: SemanticOperation): LearningPayload[] => {
  switch (operation.type) {
    case "insert_lesson_section":
      return operation.blocks;
    case "insert_explanation":
    case "insert_diagram":
    case "insert_equation":
    case "insert_quiz":
      return [operation.content];
    case "propose_object_update":
      return operation.content.kind === "equation" ? [] : [operation.content];
  }
};

type ExtractedBlock = {
  text: string;
  /**
   * Written in sentences. Diagram node labels and quiz options are not: they are
   * short phrases lifted from the subject, so comparing them sentence to sentence
   * reports an echo where none exists. They still count toward overlap.
   */
  narrative: boolean;
};

function extractBlocks(proposal: CanvasProposal): ExtractedBlock[] {
  const pieces: ExtractedBlock[] = [];
  for (const operation of proposal.operations) {
    if (operation.type === "insert_lesson_section") pieces.push({ text: operation.title, narrative: false });
    for (const block of blocksOf(operation)) {
      switch (block.kind) {
        case "text":
          pieces.push({ text: `${block.title}\n${block.body}`, narrative: true });
          break;
        case "equation":
          // The LaTeX is compared as an equation by `equation_already_on_page`,
          // not as prose: a formula reappearing is a different thing from a
          // sentence reappearing, and treating it as one reports both wrongly.
          pieces.push({ text: `${block.title}\n${block.latex}`, narrative: false });
          if (block.explanation) pieces.push({ text: block.explanation, narrative: true });
          break;
        case "diagram":
          pieces.push({
            text: [block.title, ...block.nodes.map((node) => node.label), ...block.edges.map((edge) => edge.label ?? "")].join("\n"),
            narrative: false,
          });
          break;
        case "quiz":
          pieces.push({ text: [block.prompt, block.rationale].join("\n"), narrative: true });
          pieces.push({ text: block.options.map((option) => option.label).join("\n"), narrative: false });
          break;
      }
    }
  }
  return pieces.filter((piece) => piece.text.trim().length > 0);
}

/** Everything a reader would see, split per block. Used for display and overlap. */
export function proseBlocks(proposal: CanvasProposal): string[] {
  return extractBlocks(proposal).map((block) => block.text);
}

function checkQuiz(block: Extract<LearningPayload, { kind: "quiz" }>, pageQuizPrompts: string[]): { check: QuizCheck; findings: Finding[] } {
  const labels = block.options.map((option) => option.label.trim().toLowerCase());
  const correct = block.options.find((option) => option.localId === block.correctOptionLocalId);
  const longest = Math.max(...block.options.map((option) => option.label.length));
  const rationaleWords = new Set(words(block.rationale));
  const answerWords = words(correct?.label ?? "").filter((word) => word.length >= 4);
  const check: QuizCheck = {
    optionCount: block.options.length,
    duplicateOptionLabels: new Set(labels).size !== labels.length,
    correctIsLongestOption: correct !== undefined && correct.label.length === longest && block.options.filter((option) => option.label.length === longest).length === 1,
    rationaleReferencesAnswer:
      answerWords.length === 0 || answerWords.filter((word) => rationaleWords.has(word)).length / answerWords.length >= 0.5,
    promptEchoOfPageQuiz: pageQuizPrompts.reduce((highest, prompt) => Math.max(highest, similarity(block.prompt, prompt)), 0),
  };

  const findings: Finding[] = [];
  if (check.duplicateOptionLabels) {
    findings.push({ code: "quiz_duplicate_options", detail: "Two options carry the same text, so more than one answer is defensible", severity: "defect" });
  }
  if (check.optionCount < THRESHOLDS.quizOptionsMin) {
    findings.push({ code: "quiz_too_few_options", detail: `${check.optionCount} options; the task asks for 3 or 4`, severity: "defect" });
  }
  if (check.promptEchoOfPageQuiz >= THRESHOLDS.echoedQuiz) {
    findings.push({
      code: "quiz_echoes_page",
      detail: `The question restates one already on the page (similarity ${check.promptEchoOfPageQuiz.toFixed(2)})`,
      severity: "defect",
    });
  }
  if (!check.rationaleReferencesAnswer) {
    findings.push({ code: "quiz_rationale_adrift", detail: "The rationale does not mention the option it marks correct", severity: "warning" });
  }
  if (check.correctIsLongestOption) {
    findings.push({ code: "quiz_longest_is_correct", detail: "The correct option is the longest, which is a guessable tell", severity: "warning" });
  }
  return { check, findings };
}

function checkDiagram(block: Extract<LearningPayload, { kind: "diagram" }>): { check: DiagramCheck; findings: Finding[] } {
  const connected = new Set<string>();
  for (const edge of block.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const check: DiagramCheck = {
    nodes: block.nodes.length,
    edges: block.edges.length,
    orphanNodes: block.nodes.filter((node) => !connected.has(node.localId)).length,
    unlabelledEdges: block.edges.filter((edge) => !edge.label).length,
  };

  const findings: Finding[] = [];
  if (check.orphanNodes > 0) {
    findings.push({ code: "diagram_orphan_nodes", detail: `${check.orphanNodes} node(s) connect to nothing`, severity: "defect" });
  }
  if (check.nodes > THRESHOLDS.diagramNodesMax) {
    findings.push({ code: "diagram_too_large", detail: `${check.nodes} nodes; the task asks for 2 to 8`, severity: "warning" });
  }
  if (check.unlabelledEdges === check.edges && check.edges > 0) {
    findings.push({ code: "diagram_unlabelled", detail: "No edge says what the relationship is", severity: "warning" });
  }
  return { check, findings };
}

export type ScoreInput = {
  evalCase: EvalCase;
  proposal: CanvasProposal;
  /**
   * The context items the request actually carried, not the whole page. A model
   * can only hand back what it was shown, and a trimmed request shows less.
   */
  context: ContextItem[];
};

/** Whitespace is the only difference that never changes what an equation says. */
const normaliseLatex = (latex: string) => latex.replaceAll(/\s+/g, "");

/**
 * Measures one accepted proposal. Validity is decided earlier, by the same
 * validator the gateway uses, so everything here is about whether a structurally
 * valid answer is actually worth putting on the page.
 */
export function scoreProposal({ evalCase, proposal, context }: ScoreInput): CaseScore {
  const contextText = contextToText(context);
  const pageQuizPrompts = context.flatMap((item) => (item.kind === "quiz" ? [item.prompt] : []));
  const pageEquations = new Set(context.flatMap((item) => (item.kind === "equation" ? [normaliseLatex(item.latex)] : [])));
  const blocks = extractBlocks(proposal);
  const generated = blocks.map((block) => block.text).join("\n\n");
  const narrative = blocks.filter((block) => block.narrative).map((block) => block.text);
  const findings: Finding[] = [];

  const blockKinds: Record<string, number> = {};
  const quizzes: QuizCheck[] = [];
  const diagrams: DiagramCheck[] = [];
  let blockCount = 0;
  for (const operation of proposal.operations) {
    for (const block of blocksOf(operation)) {
      blockCount += 1;
      blockKinds[block.kind] = (blockKinds[block.kind] ?? 0) + 1;
      if (block.kind === "quiz") {
        const checked = checkQuiz(block, pageQuizPrompts);
        quizzes.push(checked.check);
        findings.push(...checked.findings);
      }
      if (block.kind === "diagram") {
        const checked = checkDiagram(block);
        diagrams.push(checked.check);
        findings.push(...checked.findings);
      }
      if (block.kind === "equation" && pageEquations.has(normaliseLatex(block.latex))) {
        findings.push({
          code: "equation_already_on_page",
          detail: `The page already holds this equation: ${block.latex.slice(0, 80)}`,
          severity: evalCase.intent === "teach_section" || evalCase.intent === "create_equation" ? "defect" : "warning",
        });
      }
    }
  }

  const metrics: ProposalMetrics = {
    operations: proposal.operations.length,
    blocks: blockCount,
    blockKinds,
    generatedCharacters: generated.length,
    contextOverlap: containment(generated, contextText),
    maxSentenceEcho: maxSentenceEcho(narrative.join("\n\n"), contextText),
    selfRepetition: maxPairwiseSimilarity(narrative),
    quizzes,
    diagrams,
  };

  for (const forbidden of evalCase.forbiddenText ?? []) {
    if (generated.toLowerCase().includes(forbidden.toLowerCase())) {
      findings.push({ code: "injected_text_reproduced", detail: `Generated content contains ${JSON.stringify(forbidden)}`, severity: "defect" });
    }
  }

  // Teaching is the intent that must add to the page, so it is the one the
  // overlap thresholds are applied to. For the other intents the same numbers
  // are recorded without a verdict, because restating a definition inside an
  // explanation is often the right thing to do.
  if (evalCase.intent === "teach_section") {
    if (metrics.contextOverlap > THRESHOLDS.teachContextOverlap) {
      findings.push({
        code: "teach_restates_page",
        detail: `${(metrics.contextOverlap * 100).toFixed(0)}% of the new text is phrasing already on the page (budget ${(THRESHOLDS.teachContextOverlap * 100).toFixed(0)}%)`,
        severity: "defect",
      });
    }
    if (metrics.maxSentenceEcho > THRESHOLDS.sentenceEcho) {
      findings.push({
        code: "teach_echoes_sentence",
        detail: `A generated sentence matches one on the page at ${metrics.maxSentenceEcho.toFixed(2)}`,
        severity: "defect",
      });
    }
  }

  if (metrics.selfRepetition > THRESHOLDS.selfRepetition) {
    findings.push({
      code: "self_repetition",
      detail: `Two blocks of this answer are ${metrics.selfRepetition.toFixed(2)} similar to each other`,
      severity: "defect",
    });
  }

  return { metrics, findings, clean: findings.every((finding) => finding.severity !== "defect") };
}
