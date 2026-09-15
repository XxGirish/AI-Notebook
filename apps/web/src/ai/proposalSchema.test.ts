import { describe, expect, it } from "vitest";
import { CanvasProposalSchema, ProposalValidationError, validateCanvasProposal, type CanvasProposal, type SemanticOperationType, type TrustedProposalContext } from "./proposalSchema";

const permitted = new Set<SemanticOperationType>(["insert_lesson_section", "insert_explanation", "insert_diagram", "insert_equation", "insert_quiz", "propose_object_update"]);
const trusted: TrustedProposalContext = {
  requestId: "request-1",
  pageId: "page-1",
  permittedOperations: permitted,
  targetObjects: new Map([["note-1", { kind: "text-card", revision: 3 }]]),
  maxOperations: 8,
};

const validProposal: CanvasProposal = {
  schemaVersion: 1,
  operations: [
    {
      type: "insert_diagram",
      localId: "diagram-1",
      anchor: { relation: "after_selection" },
      content: {
        kind: "diagram",
        title: "Gradient descent",
        direction: "left_to_right",
        nodes: [{ localId: "prediction", label: "Prediction" }, { localId: "loss", label: "Loss" }],
        edges: [{ from: "prediction", to: "loss", label: "compare" }],
      },
    },
    {
      type: "insert_quiz",
      localId: "quiz-1",
      anchor: { relation: "below_selection" },
      content: {
        kind: "quiz",
        prompt: "What does the loss measure?",
        options: [{ localId: "a", label: "Model error" }, { localId: "b", label: "Dataset size" }],
        correctOptionLocalId: "a",
        rationale: "Loss compares predictions with the expected output.",
        conceptTags: ["optimization"],
      },
    },
  ],
};

describe("canvas proposal schema", () => {
  it("accepts bounded semantic operations", () => {
    expect(validateCanvasProposal(validProposal, trusted)).toEqual(validProposal);
  });

  it("rejects unknown fields instead of accepting executable or engine data", () => {
    const input = structuredClone(validProposal) as CanvasProposal & { javascript?: string };
    input.javascript = "alert('no')";
    expect(() => validateCanvasProposal(input, trusted)).toThrow(/Unrecognized key/);
  });

  it("rejects duplicate and dangling diagram references", () => {
    const input = structuredClone(validProposal);
    const diagram = input.operations[0];
    if (diagram.type !== "insert_diagram") throw new Error("Fixture operation changed");
    diagram.content.nodes[1].localId = "prediction";
    diagram.content.edges[0].to = "missing";
    const result = CanvasProposalSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining(["Duplicate diagram node: prediction", "Unknown diagram node: missing"]));
  });

  it("rejects a quiz answer key that does not reference an option", () => {
    const input = structuredClone(validProposal);
    const quiz = input.operations[1];
    if (quiz.type !== "insert_quiz") throw new Error("Fixture operation changed");
    quiz.content.correctOptionLocalId = "missing";
    expect(CanvasProposalSchema.safeParse(input).success).toBe(false);
  });

  it("enforces trusted operation permissions and request limits", () => {
    expect(() => validateCanvasProposal(validProposal, { ...trusted, permittedOperations: new Set(["insert_quiz"]) })).toThrow(/insert_diagram was not permitted/);
    expect(() => validateCanvasProposal(validProposal, { ...trusted, maxOperations: 1 })).toThrow(/exceeds this request's limit/);
  });

  it("allows only current, type-compatible updates to trusted targets", () => {
    const update: CanvasProposal = {
      schemaVersion: 1,
      operations: [{ type: "propose_object_update", targetId: "note-1", expectedRevision: 3, content: { kind: "text", title: "Revised", body: "Clearer explanation" } }],
    };
    expect(validateCanvasProposal(update, trusted)).toEqual(update);

    const stale = structuredClone(update);
    const staleOperation = stale.operations[0];
    if (staleOperation.type !== "propose_object_update") throw new Error("Fixture operation changed");
    staleOperation.expectedRevision = 2;
    expect(() => validateCanvasProposal(stale, trusted)).toThrow(ProposalValidationError);

    const wrongKind = structuredClone(update);
    const wrongKindOperation = wrongKind.operations[0];
    if (wrongKindOperation.type !== "propose_object_update") throw new Error("Fixture operation changed");
    wrongKindOperation.content = { kind: "equation", title: "Not a note", latex: "x = 1" };
    expect(() => validateCanvasProposal(wrongKind, trusted)).toThrow(/does not match target/);

    const wrongTarget = structuredClone(update);
    const wrongOperation = wrongTarget.operations[0];
    if (wrongOperation.type !== "propose_object_update") throw new Error("Fixture operation changed");
    wrongOperation.targetId = "other-note";
    expect(() => validateCanvasProposal(wrongTarget, trusted)).toThrow(/was not permitted/);
  });
});
