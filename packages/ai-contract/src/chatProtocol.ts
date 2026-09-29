import { z } from "zod";
import type { GatewayErrorCode, UsageReport } from "./gatewayProtocol";

// The side-panel chat. Unlike canvas actions it returns prose, not a proposal:
// nothing it produces reaches the document until the writer chooses "Add to
// page", which goes through the ordinary validated draft path in the browser.
//
// Retrieval happens on the device. The browser picks a bounded set of passages
// from uploaded sources and notebook pages and labels them S1, S2, …; the model
// may cite only those labels, and the browser ignores any citation it did not send.

/** Upper bound on a serialized chat request, enforced before parsing. */
export const MAX_CHAT_REQUEST_BYTES = 192 * 1024;
export const MAX_CHAT_PASSAGES = 16;
export const MAX_CHAT_PASSAGE_CHARACTERS = 4_000;
export const MAX_CHAT_MESSAGES = 12;
export const MAX_CHAT_MESSAGE_CHARACTERS = 6_000;

export const CHAT_PASSAGE_ID_PATTERN = /^S[1-9][0-9]?$/;

export const ChatPassageSchema = z.object({
  id: z.string().regex(CHAT_PASSAGE_ID_PATTERN),
  /** Where the passage came from, for the model's attribution only: a file name or a page title. */
  origin: z.string().trim().min(1).max(200),
  /** A human locator such as "p. 4"; empty when there is none. */
  locator: z.string().max(80),
  text: z.string().trim().min(1).max(MAX_CHAT_PASSAGE_CHARACTERS),
}).strict();

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARACTERS),
}).strict();

export const ChatRequestSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "Use an opaque request identifier"),
  messages: z.array(ChatMessageSchema).min(1).max(MAX_CHAT_MESSAGES),
  passages: z.array(ChatPassageSchema).max(MAX_CHAT_PASSAGES),
}).strict().superRefine((request, context) => {
  if (request.messages.at(-1)?.role !== "user") {
    context.addIssue({ code: "custom", path: ["messages"], message: "The last message must be the user's question" });
  }
  const ids = new Set<string>();
  for (const [index, passage] of request.passages.entries()) {
    if (ids.has(passage.id)) context.addIssue({ code: "custom", path: ["passages", index, "id"], message: "Duplicate passage id" });
    ids.add(passage.id);
  }
});

export type ChatPassage = z.infer<typeof ChatPassageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export type ChatEvent =
  | { type: "started"; requestId: string; provider: string; model: string }
  | { type: "delta"; text: string }
  | { type: "usage"; usage: UsageReport }
  | { type: "complete" }
  | { type: "error"; code: GatewayErrorCode; message: string; retryable: boolean };

/**
 * The citation labels an answer uses, restricted to those that were sent. A
 * label the model invented is dropped rather than shown as a source.
 */
export function citedPassageIds(answer: string, sentIds: Iterable<string>): string[] {
  const allowed = new Set(sentIds);
  const cited: string[] = [];
  for (const match of answer.matchAll(/\[(S[1-9][0-9]?)\]/g)) {
    const id = match[1];
    if (allowed.has(id) && !cited.includes(id)) cited.push(id);
  }
  return cited;
}
