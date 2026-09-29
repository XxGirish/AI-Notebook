import MiniSearch from "minisearch";
import { MAX_CHAT_PASSAGES, type ChatPassage, type ContextItem } from "@ai-notebook/ai-contract";
import type { NotebookPage } from "../domain/pages";
import { buildContextCandidates } from "../ai/requestContext";
import type { ChatCitation, SourceChunkRecord, SourceRecord } from "../persistence/notebookDatabase";
import { chunkSegments } from "./chunkText";

/**
 * On-device keyword retrieval (BM25 through MiniSearch) over uploaded sources
 * and the text of every notebook page. It needs no model and no network, so it
 * works offline and nothing is sent anywhere until the writer asks a question.
 *
 * DeepSeek offers no embeddings endpoint; semantic search would need a second
 * provider or a large in-browser model. Keyword search matches the exact
 * technical terms study material is full of, and can be joined by a vector
 * index later without changing what the chat sends.
 */

export type RetrievalDocument = {
  id: string;
  kind: "source" | "note";
  origin: string;
  locator: string;
  text: string;
  sourceId?: string;
  pageId?: string;
  objectId?: string;
  ordinal?: number;
};

export type RetrievedPassage = ChatPassage & { citation: ChatCitation };

export type RetrieveOptions = {
  question: string;
  /** Earlier questions in the conversation; a short follow-up such as "why?" borrows their terms. */
  previousQuestions?: string[];
  enabledSourceIds: ReadonlySet<string>;
  includeNotes: boolean;
  activePageId?: string;
  maxPassages?: number;
  characterBudget?: number;
};

export const DEFAULT_CHARACTER_BUDGET = 24_000;
const MAX_PASSAGES_PER_ORIGIN = 6;
const FOLLOW_UP_WORD_LIMIT = 6;

const STOP_WORDS = new Set(("a an and are as at be but by can do does for from how i if in into is it its me my of on or " +
  "please so than that the their them then there these this those to was what when where which who why will with you your " +
  "explain tell about give show").split(" "));

const clamp = (value: string, limit: number) => (value.length <= limit ? value : `${value.slice(0, limit - 1)}…`);

const processTerm = (term: string) => {
  const lower = term.toLowerCase();
  return lower.length < 2 || STOP_WORDS.has(lower) ? null : lower;
};

function textOfContextItem(item: ContextItem): { locator: string; text: string } {
  switch (item.kind) {
    case "text":
      return { locator: item.title || "Note", text: item.title ? `${item.title}\n\n${item.body}` : item.body };
    case "equation":
      return { locator: item.title || "Equation", text: `${item.title}\n$${item.latex}$` };
    case "quiz":
      // The answer key is never indexed: only the question and its choices.
      return { locator: "Quiz", text: `${item.prompt}\n${item.options.map((option) => `- ${option.label}`).join("\n")}` };
    case "diagram": {
      const labels = new Map(item.nodes.map((node) => [node.id, node.label]));
      const edges = item.edges.map((edge) => `${labels.get(edge.fromId)} ${edge.label ?? "→"} ${labels.get(edge.toId)}`);
      return { locator: "Diagram", text: [...item.nodes.map((node) => node.label), ...edges].join("\n") };
    }
  }
}

/** Every searchable piece of text on the notebook's pages, long notes split like source files. */
export function noteDocuments(pages: readonly NotebookPage[]): RetrievalDocument[] {
  const documents: RetrievalDocument[] = [];
  for (const page of pages) {
    for (const candidate of buildContextCandidates(page.objects, new Set(), { x: 0, y: 0 })) {
      const { locator, text } = textOfContextItem(candidate.item);
      if (!text.trim()) continue;
      const revision = "revision" in candidate.item ? candidate.item.revision : candidate.item.nodes.map((node) => node.revision).join(".");
      const parts = chunkSegments([{ text }]);
      parts.forEach((part, index) => {
        documents.push({
          id: `note:${page.id}:${candidate.item.id}:${revision}:${index}`,
          kind: "note",
          origin: `Notebook page “${page.title}”`,
          locator: parts.length > 1 ? `${locator}, part ${index + 1}` : locator,
          text: part.text,
          pageId: page.id,
          objectId: candidate.item.id,
        });
      });
    }
  }
  return documents;
}

export function sourceDocuments(sources: readonly SourceRecord[], chunks: readonly SourceChunkRecord[]): RetrievalDocument[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return chunks.flatMap((chunk) => {
    const source = byId.get(chunk.sourceId);
    if (!source) return [];
    return [{
      id: chunk.id,
      kind: "source" as const,
      origin: source.name,
      locator: chunk.page !== undefined ? `p. ${chunk.page}` : `section ${chunk.ordinal + 1}`,
      text: chunk.text,
      sourceId: source.id,
      ordinal: chunk.ordinal,
    }];
  });
}

function retrievalQuery(question: string, previous: readonly string[]): string {
  const words = question.trim().split(/\s+/).filter(Boolean);
  if (words.length >= FOLLOW_UP_WORD_LIMIT || previous.length === 0) return question;
  return `${question} ${previous.at(-1)}`;
}

export class NotebookRetriever {
  private readonly index = new MiniSearch<RetrievalDocument>({
    fields: ["text", "locator"],
    idField: "id",
    processTerm,
    searchOptions: {
      boost: { locator: 1.5 },
      prefix: (term) => term.length > 3,
      fuzzy: (term) => (term.length > 5 ? 0.2 : false),
      combineWith: "OR",
    },
  });
  private readonly documents = new Map<string, RetrievalDocument>();

  get size() {
    return this.documents.size;
  }

  /** Brings one kind of document in line with `next`, touching only what changed. */
  private sync(kind: RetrievalDocument["kind"], next: readonly RetrievalDocument[]) {
    const wanted = new Map(next.map((document) => [document.id, document]));
    for (const [id, document] of this.documents) {
      if (document.kind === kind && !wanted.has(id)) {
        this.index.discard(id);
        this.documents.delete(id);
      }
    }
    const added = next.filter((document) => !this.documents.has(document.id));
    for (const document of added) this.documents.set(document.id, document);
    this.index.addAll(added);
  }

  setSources(sources: readonly SourceRecord[], chunks: readonly SourceChunkRecord[]) {
    this.sync("source", sourceDocuments(sources, chunks));
  }

  setPages(pages: readonly NotebookPage[]) {
    this.sync("note", noteDocuments(pages));
  }

  /**
   * The best passages for a question within a fixed size, labelled S1, S2, … in
   * the order they are sent. When nothing matches, as with "summarise this",
   * the opening passages of each enabled source stand in.
   */
  retrieve(options: RetrieveOptions): RetrievedPassage[] {
    const maxPassages = Math.min(options.maxPassages ?? 12, MAX_CHAT_PASSAGES);
    const budget = options.characterBudget ?? DEFAULT_CHARACTER_BUDGET;
    const allowed = (document: RetrievalDocument) =>
      document.kind === "source" ? options.enabledSourceIds.has(document.sourceId!) : options.includeNotes;

    const query = retrievalQuery(options.question, options.previousQuestions ?? []);
    const hits = this.index.search(query, {
      filter: (result) => {
        const document = this.documents.get(result.id as string);
        return document !== undefined && allowed(document);
      },
      boostDocument: (id) => (this.documents.get(id as string)?.pageId === options.activePageId && options.activePageId ? 1.3 : 1),
    });

    const chosen: RetrievalDocument[] = [];
    const perOrigin = new Map<string, number>();
    let used = 0;
    const take = (document: RetrievalDocument) => {
      if (chosen.length >= maxPassages || chosen.includes(document)) return;
      const originCount = perOrigin.get(document.origin) ?? 0;
      if (originCount >= MAX_PASSAGES_PER_ORIGIN) return;
      if (used + document.text.length > budget) return;
      chosen.push(document);
      perOrigin.set(document.origin, originCount + 1);
      used += document.text.length;
    };

    for (const hit of hits) {
      const document = this.documents.get(hit.id as string);
      if (document) take(document);
    }

    if (chosen.length < 3) {
      const openings = [...this.documents.values()]
        .filter((document) => document.kind === "source" && allowed(document) && (document.ordinal ?? 0) < 2)
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
      for (const document of openings) take(document);
    }

    return chosen.map((document, index) => {
      const id = `S${index + 1}`;
      const origin = clamp(document.origin, 200);
      const locator = clamp(document.locator, 80);
      return {
        id,
        origin,
        locator,
        text: document.text,
        citation: {
          id,
          origin,
          locator,
          text: document.text,
          ...(document.sourceId ? { sourceId: document.sourceId } : {}),
          ...(document.pageId ? { pageId: document.pageId } : {}),
          ...(document.objectId ? { objectId: document.objectId } : {}),
        },
      };
    });
  }
}
