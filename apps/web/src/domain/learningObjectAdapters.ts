import { z } from "zod";
import type { EquationCardObject, QuizCardObject, TextCardObject } from "./notebook";

export type LearningCardObject = TextCardObject | EquationCardObject | QuizCardObject;
export type LearningObjectSize = { width: number; height: number };

export type LearningObjectRenderModel =
  | { kind: "text"; title: string; body: string }
  | { kind: "equation"; title: string; latex: string }
  | { kind: "quiz"; prompt: string; options: Array<{ id: string; label: string }>; correctOptionId: string; rationale: string };

export type LearningObjectExportModel = LearningObjectRenderModel;

export interface LearningObjectAdapter {
  validate(value: unknown): string[];
  measure(object: LearningCardObject): LearningObjectSize;
  render(object: LearningCardObject): LearningObjectRenderModel;
  toPlainText(object: LearningCardObject, options?: { includeAnswer?: boolean }): string;
  toExport(object: LearningCardObject): LearningObjectExportModel;
  migrate(value: unknown): LearningCardObject;
}

const baseObjectSchema = z.object({
  id: z.string().min(1).max(200),
  revision: z.number().int().min(1),
  groupId: z.string().min(1).max(200).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
}).strict();

const textCardSchema = baseObjectSchema.extend({
  kind: z.literal("text-card"),
  title: z.string().min(1).max(160),
  body: z.string().max(8_000),
}).strict();

const equationCardSchema = baseObjectSchema.extend({
  kind: z.literal("equation-card"),
  title: z.string().min(1).max(160),
  latex: z.string().min(1).max(2_000),
}).strict();

const quizCardSchema = baseObjectSchema.extend({
  kind: z.literal("quiz-card"),
  prompt: z.string().min(1).max(1_500),
  options: z.array(z.object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(240),
  }).strict()).min(2).max(6),
  correctOptionId: z.string().min(1).max(200),
  rationale: z.string().min(1).max(3_000),
}).strict().superRefine((quiz, context) => {
  const optionIds = new Set<string>();
  for (const [index, option] of quiz.options.entries()) {
    if (optionIds.has(option.id)) {
      context.addIssue({ code: "custom", path: ["options", index, "id"], message: `Duplicate quiz option: ${option.id}` });
    }
    optionIds.add(option.id);
  }
  if (!optionIds.has(quiz.correctOptionId)) {
    context.addIssue({ code: "custom", path: ["correctOptionId"], message: "The answer key must reference an option" });
  }
});

const learningCardSchema = z.union([textCardSchema, equationCardSchema, quizCardSchema]);

// Migration accepts the wider limits used by earlier stored-page/archive
// validators so an existing notebook is never truncated merely because the
// interactive editor now applies tighter authoring limits.
const legacyTextCardSchema = baseObjectSchema.extend({
  kind: z.literal("text-card"),
  title: z.string().min(1).max(10_000),
  body: z.string().max(200_000),
}).strict();
const legacyEquationCardSchema = baseObjectSchema.extend({
  kind: z.literal("equation-card"),
  title: z.string().min(1).max(10_000),
  latex: z.string().min(1).max(50_000),
}).strict();
const legacyQuizCardSchema = baseObjectSchema.extend({
  kind: z.literal("quiz-card"),
  prompt: z.string().min(1).max(50_000),
  options: z.array(z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(20_000) }).strict()).min(2).max(20),
  correctOptionId: z.string().min(1).max(200),
  rationale: z.string().min(1).max(100_000),
}).strict().superRefine((quiz, context) => {
  const optionIds = new Set(quiz.options.map((option) => option.id));
  if (optionIds.size !== quiz.options.length) context.addIssue({ code: "custom", path: ["options"], message: "Quiz option IDs must be unique" });
  if (!optionIds.has(quiz.correctOptionId)) context.addIssue({ code: "custom", path: ["correctOptionId"], message: "The answer key must reference an option" });
});
const legacyLearningCardSchema = z.union([legacyTextCardSchema, legacyEquationCardSchema, legacyQuizCardSchema]);

const textHeight = (text: string, width: number, base: number) => {
  const charactersPerLine = Math.max(18, Math.floor((width - 36) / 7.2));
  return base + Math.ceil(text.length / charactersPerLine) * 20;
};

function renderModel(object: LearningCardObject): LearningObjectRenderModel {
  if (object.kind === "text-card") return { kind: "text", title: object.title, body: object.body };
  if (object.kind === "equation-card") return { kind: "equation", title: object.title, latex: object.latex };
  return {
    kind: "quiz",
    prompt: object.prompt,
    options: object.options.map((option) => ({ ...option })),
    correctOptionId: object.correctOptionId,
    rationale: object.rationale,
  };
}

export const learningObjectAdapter: LearningObjectAdapter = {
  validate(value) {
    const result = learningCardSchema.safeParse(value);
    if (result.success) return [];
    return result.error.issues.map((issue) => `${issue.path.join(".") || "object"}: ${issue.message}`);
  },

  measure(object) {
    if (object.kind === "text-card") {
      const width = 320;
      return { width, height: Math.max(140, Math.min(420, textHeight(object.body, width, 78))) };
    }
    if (object.kind === "equation-card") return { width: 320, height: 140 };
    return { width: 340, height: Math.max(260, 150 + object.options.length * 46) };
  },

  render: renderModel,

  toPlainText(object, options = {}) {
    const model = renderModel(object);
    if (model.kind === "text") return [model.title, model.body].filter(Boolean).join("\n\n");
    if (model.kind === "equation") return `${model.title}\n\n${model.latex}`;
    const choices = model.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
    if (!options.includeAnswer) return `${model.prompt}\n${choices}`;
    const answer = model.options.find((option) => option.id === model.correctOptionId)?.label ?? "Unknown answer";
    return `${model.prompt}\n${choices}\n\nAnswer: ${answer}\n${model.rationale}`;
  },

  toExport: renderModel,

  migrate(value) {
    if (typeof value !== "object" || value === null) throw new Error("Learning object is not a record");
    const candidate = { ...(value as Record<string, unknown>) };
    if (!Number.isInteger(candidate.revision) || (candidate.revision as number) < 1) candidate.revision = 1;
    const result = legacyLearningCardSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`Learning object migration failed at ${issue.path.join(".") || "object"}: ${issue.message}`);
    }
    return result.data;
  },
};

export function isLearningCardObject(object: { kind: string }): object is LearningCardObject {
  return object.kind === "text-card" || object.kind === "equation-card" || object.kind === "quiz-card";
}
