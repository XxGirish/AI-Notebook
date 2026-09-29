import {
  MAX_CHAT_MESSAGE_CHARACTERS,
  MAX_CHAT_MESSAGES,
  MAX_CHAT_REQUEST_BYTES,
  type ChatMessage,
  type ChatPassage,
  type ChatRequest,
} from "@ai-notebook/ai-contract";
import type { NotebookPage } from "../domain/pages";
import type { ChatCitation, ChatMessageRecord } from "../persistence/notebookDatabase";
import { buildContextCandidates } from "./requestContext";

/** Leaves room below the gateway's limit for JSON escaping of unusual characters. */
const REQUEST_BYTE_BUDGET = MAX_CHAT_REQUEST_BYTES - 8 * 1024;

const clamp = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1)}…`);
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Builds a bounded chat request: the newest completed turns, the question, and
 * the retrieved passages. When it is too large the oldest turns go first, then
 * the least relevant passages, so a long conversation never stops working.
 */
export function buildChatRequest(options: {
  requestId: string;
  history: readonly ChatMessageRecord[];
  question: string;
  passages: readonly ChatPassage[];
}): ChatRequest {
  const earlier: ChatMessage[] = options.history
    .filter((message) => !message.incomplete && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: clamp(message.content.trim(), MAX_CHAT_MESSAGE_CHARACTERS) }));
  const question: ChatMessage = { role: "user", content: clamp(options.question.trim(), MAX_CHAT_MESSAGE_CHARACTERS) };

  let messages = [...earlier.slice(-(MAX_CHAT_MESSAGES - 1)), question];
  // A conversation sent to the model starts with the student's turn.
  while (messages.length > 1 && messages[0].role !== "user") messages = messages.slice(1);
  // Only the contract's fields leave the device; callers may carry more (such as citation links).
  const passages: ChatPassage[] = options.passages.map(({ id, origin, locator, text }) => ({ id, origin, locator, text }));

  const request = (): ChatRequest => ({ requestId: options.requestId, messages, passages });
  while (byteLength(request()) > REQUEST_BYTE_BUDGET && messages.length > 1) {
    messages = messages.slice(1);
    while (messages.length > 1 && messages[0].role !== "user") messages = messages.slice(1);
  }
  while (byteLength(request()) > REQUEST_BYTE_BUDGET && passages.length > 0) passages.pop();
  return request();
}

/** Chat Markdown as plain card text: bullets become "•", emphasis and code markers are dropped. */
function plainCardText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

/** The text for an answer card: citation labels become readable references to the passages they name. */
export function answerForCanvas(answer: string, citations: ReadonlyArray<{ id: string; origin: string; locator: string }>): string {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  const used: string[] = [];
  const body = plainCardText(answer).replace(/\[(S[1-9][0-9]?)\]/g, (match, id: string) => {
    if (!byId.has(id)) return "";
    if (!used.includes(id)) used.push(id);
    return `[${used.indexOf(id) + 1}]`;
  }).replace(/[ \t]+([.,;:])/g, "$1").trim();
  if (used.length === 0) return body;
  const references = used.map((id, index) => {
    const citation = byId.get(id)!;
    return `[${index + 1}] ${citation.origin}${citation.locator ? `, ${citation.locator}` : ""}`;
  });
  return `${body}\n\nSources:\n${references.join("\n")}`;
}

/**
 * The objects on one page that an answer cited, as provenance sources. A
 * derived diagram citation stands for all of its nodes. Citations of uploaded
 * files or other pages are left out: they are not objects on this page, and
 * the answer's text already names them.
 */
export function citedPageSources(citations: readonly ChatCitation[], page: Pick<NotebookPage, "id" | "objects">): Array<{ id: string; revision: number }> {
  const byId = new Map(page.objects.map((object) => [object.id, object]));
  const diagrams = new Map<string, Array<{ id: string; revision: number }>>();
  for (const candidate of buildContextCandidates(page.objects, new Set(), { x: 0, y: 0 })) {
    if (candidate.item.kind === "diagram") diagrams.set(candidate.item.id, candidate.item.nodes.map(({ id, revision }) => ({ id, revision })));
  }
  const sources = new Map<string, { id: string; revision: number }>();
  for (const citation of citations) {
    if (citation.pageId !== page.id || !citation.objectId) continue;
    const object = byId.get(citation.objectId);
    const cited = object ? [{ id: object.id, revision: object.revision }] : diagrams.get(citation.objectId) ?? [];
    for (const source of cited) sources.set(source.id, source);
  }
  return [...sources.values()];
}
