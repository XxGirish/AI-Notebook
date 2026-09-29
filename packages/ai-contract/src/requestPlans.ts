import { AI_INTENTS, type AiIntent } from "./gatewayProtocol";
import type { SemanticOperationType } from "./proposalSchema";

/**
 * What one AI action is allowed to ask for.
 *
 * The browser still decides and enforces this: it sends the plan with the
 * request and applies it again locally when the returned proposal is validated,
 * so nothing here grants the gateway or the model any authority. The plans live
 * in the shared contract because the gateway's prompt evaluation has to build
 * exactly the requests the application builds; a second copy would drift.
 */
export type AiRequestPlan = {
  label: string;
  permittedOperations: SemanticOperationType[];
  maxOperations: number;
  /** Actions that read the writer's work refuse to run with nothing selected. */
  requiresContext: boolean;
};

// `propose_object_update` is deliberately absent from every plan: no action
// exposed on the canvas yet rewrites existing objects, so no request permits it
// and `targets` stays empty.
export const AI_REQUEST_PLANS: Record<AiIntent, AiRequestPlan> = {
  teach_section: { label: "Teach a section", permittedOperations: ["insert_lesson_section"], maxOperations: 2, requiresContext: false },
  explain_selection: { label: "Explain selection", permittedOperations: ["insert_explanation"], maxOperations: 2, requiresContext: true },
  create_diagram: { label: "Create diagram", permittedOperations: ["insert_diagram"], maxOperations: 1, requiresContext: true },
  create_equation: { label: "Create equation", permittedOperations: ["insert_equation"], maxOperations: 2, requiresContext: true },
  create_quiz: { label: "Create quiz", permittedOperations: ["insert_quiz"], maxOperations: 3, requiresContext: true },
};

/** The actions the canvas toolbar offers, in toolbar order. */
export const AI_CANVAS_ACTIONS: AiIntent[] = ["teach_section", "explain_selection", "create_diagram", "create_quiz"];

export const ALL_INTENTS: AiIntent[] = [...AI_INTENTS];
