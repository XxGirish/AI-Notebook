import { describe, expect, it } from "vitest";
import { ChatRequestSchema, MAX_CHAT_REQUEST_BYTES } from "@ai-notebook/ai-contract";
import type { NotebookPage } from "../domain/pages";
import type { ChatMessageRecord, SourceChunkRecord, SourceRecord } from "../persistence/notebookDatabase";
import { answerForCanvas, buildChatRequest } from "../ai/chatRequest";
import { chunkSegments, normalizeExtractedText, TARGET_CHUNK_CHARACTERS } from "./chunkText";
import { sourceKindOf } from "./extractText";
import { NotebookRetriever } from "./retrieval";

const sentence = (topic: string, index: number) => `The ${topic} statement number ${index} explains one idea in a complete sentence.`;

describe("chunkSegments", () => {
  it("keeps passages near the target size, on one page each, with a little overlap", () => {
    const pageOne = Array.from({ length: 60 }, (_, index) => sentence("momentum", index)).join(" ");
    const pageTwo = Array.from({ length: 10 }, (_, index) => sentence("energy", index)).join(" ");
    const chunks = chunkSegments([{ page: 1, text: pageOne }, { page: 2, text: pageTwo }]);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(TARGET_CHUNK_CHARACTERS + 200);
    expect(chunks.every((chunk) => chunk.page === 1 ? !chunk.text.includes("energy") : !chunk.text.includes("momentum"))).toBe(true);
    const [first, second] = chunks;
    expect(second.text.slice(0, 40)).not.toBe(first.text.slice(0, 40));
    expect(first.text.includes(second.text.split(" ").slice(0, 4).join(" "))).toBe(true);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
  });

  it("skips empty pages and cuts text with no sentence ends", () => {
    const chunks = chunkSegments([{ page: 1, text: "   \n\n " }, { page: 2, text: "x".repeat(5_000) }]);
    expect(chunks.every((chunk) => chunk.page === 2)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 1_800)).toBe(true);
  });

  it("repairs line-break hyphenation and control characters from PDF text", () => {
    expect(normalizeExtractedText("conser-\nvation\u0007 of  momentum")).toBe("conservation of momentum");
  });

  it("respects the chunk limit", () => {
    const text = Array.from({ length: 400 }, (_, index) => sentence("limit", index)).join(" ");
    expect(chunkSegments([{ text }], 5)).toHaveLength(5);
  });
});

describe("sourceKindOf", () => {
  it("recognises supported files by type or extension and refuses others", () => {
    expect(sourceKindOf({ name: "notes.PDF", type: "" })).toBe("pdf");
    expect(sourceKindOf({ name: "a.docx", type: "" })).toBe("docx");
    expect(sourceKindOf({ name: "readme.md", type: "" })).toBe("text");
    expect(sourceKindOf({ name: "x", type: "text/plain" })).toBe("text");
    expect(sourceKindOf({ name: "old.doc", type: "application/msword" })).toBeUndefined();
  });
});

const source = (id: string, name: string, enabled = true): SourceRecord => ({
  id, name, kind: "pdf", size: 1, contentHash: id, chunkCount: 0, characterCount: 0, enabled, addedAt: 1,
});
const chunk = (sourceId: string, ordinal: number, text: string, page?: number): SourceChunkRecord => ({
  id: `${sourceId}:${ordinal}`, sourceId, ordinal, text, ...(page ? { page } : {}),
});

const page = (id: string, title: string, objects: NotebookPage["objects"]): NotebookPage => ({
  id, title, objects, createdAt: 1, updatedAt: 1,
} as NotebookPage);

describe("NotebookRetriever", () => {
  const sources = [source("physics", "physics.pdf"), source("biology", "biology.pdf", false)];
  const chunks = [
    chunk("physics", 0, "Introduction to mechanics and the course outline.", 1),
    chunk("physics", 1, "Momentum is the product of mass and velocity, p = mv. Momentum is conserved in collisions.", 4),
    chunk("physics", 2, "Kinetic energy is one half m v squared.", 5),
    chunk("biology", 0, "Momentum of cell division in mitosis is a biology topic.", 2),
  ];
  const pages = [page("page-1", "Forces", [
    { id: "note-1", kind: "text-card", revision: 3, x: 0, y: 0, width: 100, height: 100, title: "Impulse", body: "Impulse equals the change in momentum." },
    {
      id: "quiz-1", kind: "quiz-card", revision: 1, x: 0, y: 200, width: 100, height: 100,
      prompt: "What is conserved in an elastic collision?", options: [{ id: "a", label: "Momentum" }, { id: "b", label: "Colour" }],
      correctOptionId: "a", rationale: "SECRET-RATIONALE",
    },
  ] as NotebookPage["objects"])];

  it("finds matching passages from enabled sources and notes, labelled in order with locators", () => {
    const retriever = new NotebookRetriever();
    retriever.setSources(sources, chunks);
    retriever.setPages(pages);
    const passages = retriever.retrieve({ question: "What is momentum?", enabledSourceIds: new Set(["physics"]), includeNotes: true });
    expect(passages.map((passage) => passage.id)).toEqual(passages.map((_, index) => `S${index + 1}`));
    expect(passages.some((passage) => passage.origin === "physics.pdf" && passage.locator === "p. 4")).toBe(true);
    expect(passages.some((passage) => passage.citation.pageId === "page-1" && passage.citation.objectId === "note-1")).toBe(true);
    expect(passages.some((passage) => passage.origin === "biology.pdf")).toBe(false);
    expect(JSON.stringify(passages)).not.toContain("SECRET-RATIONALE");
  });

  it("leaves notes out when asked and falls back to opening passages when nothing matches", () => {
    const retriever = new NotebookRetriever();
    retriever.setSources(sources, chunks);
    retriever.setPages(pages);
    const passages = retriever.retrieve({ question: "Summarise", enabledSourceIds: new Set(["physics"]), includeNotes: false });
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.every((passage) => passage.origin === "physics.pdf")).toBe(true);
    expect(passages[0].locator).toBe("p. 1");
  });

  it("follows edits and removals without rebuilding everything", () => {
    const retriever = new NotebookRetriever();
    retriever.setSources(sources, chunks);
    retriever.setPages(pages);
    const before = retriever.size;
    retriever.setSources([sources[1]], chunks.filter((item) => item.sourceId === "biology"));
    expect(retriever.size).toBe(before - 3);
    const edited = [page("page-1", "Forces", [{ ...pages[0].objects[0], revision: 4, body: "Torque turns things." } as NotebookPage["objects"][number]])];
    retriever.setPages(edited);
    const found = retriever.retrieve({ question: "torque", enabledSourceIds: new Set(), includeNotes: true });
    expect(found).toHaveLength(1);
    expect(retriever.retrieve({ question: "momentum", enabledSourceIds: new Set(), includeNotes: true })).toHaveLength(0);
  });

  it("stays inside the character budget", () => {
    const retriever = new NotebookRetriever();
    const many = Array.from({ length: 40 }, (_, index) => chunk("physics", index, `Momentum fact ${index}. ${"filler ".repeat(150)}`, index + 1));
    retriever.setSources([sources[0]], many);
    const passages = retriever.retrieve({ question: "momentum", enabledSourceIds: new Set(["physics"]), includeNotes: false, characterBudget: 5_000 });
    expect(passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(5_000);
    expect(passages.length).toBeGreaterThan(0);
  });
});

describe("buildChatRequest", () => {
  const message = (role: "user" | "assistant", content: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
    id: `${role}-${content.slice(0, 8)}`, role, content, createdAt: 1, ...extra,
  });

  it("produces a valid request ending with the question and skips stopped answers", () => {
    const request = buildChatRequest({
      requestId: "chat-request-0001",
      history: [message("user", "first"), message("assistant", "partial", { incomplete: true }), message("user", "second"), message("assistant", "answer")],
      question: "third",
      passages: [{ id: "S1", origin: "a.pdf", locator: "p. 1", text: "text" }],
    });
    expect(ChatRequestSchema.safeParse(request).success).toBe(true);
    expect(request.messages.map((item) => item.content)).toEqual(["first", "second", "answer", "third"]);
  });

  it("sends only the contract's passage fields, whatever the retriever attached", () => {
    const retriever = new NotebookRetriever();
    retriever.setSources([source("physics", "physics.pdf")], [chunk("physics", 0, "Momentum is conserved.", 1)]);
    const passages = retriever.retrieve({ question: "momentum", enabledSourceIds: new Set(["physics"]), includeNotes: false });
    const request = buildChatRequest({ requestId: "chat-request-0003", history: [], question: "momentum?", passages });
    expect(ChatRequestSchema.safeParse(request).success).toBe(true);
    expect(Object.keys(request.passages[0]).sort()).toEqual(["id", "locator", "origin", "text"]);
  });

  it("drops the oldest turns, then passages, to fit the size limit", () => {
    const long = "y".repeat(5_900);
    const history = Array.from({ length: 30 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `${index} ${long}`));
    const passages = Array.from({ length: 16 }, (_, index) => ({ id: `S${index + 1}`, origin: "a.pdf", locator: "", text: "z".repeat(3_990) }));
    const request = buildChatRequest({ requestId: "chat-request-0002", history, question: "q", passages });
    expect(new TextEncoder().encode(JSON.stringify(request)).length).toBeLessThan(MAX_CHAT_REQUEST_BYTES);
    expect(ChatRequestSchema.safeParse(request).success).toBe(true);
    expect(request.messages[0].role).toBe("user");
    expect(request.messages.at(-1)?.content).toBe("q");
  });
});

describe("answerForCanvas", () => {
  it("turns chat Markdown into plain card text", () => {
    expect(answerForCanvas("## Key idea\n- **Stroma** hosts it\n- Uses `RuBisCO`", [])).toBe("Key idea\n• Stroma hosts it\n• Uses RuBisCO");
  });

  it("numbers cited sources in order of use and lists them, dropping unknown labels", () => {
    const text = answerForCanvas("Momentum is conserved [S2]. It is p = mv [S1][S2]. Unknown [S7].", [
      { id: "S1", origin: "physics.pdf", locator: "p. 4" },
      { id: "S2", origin: "Notebook page “Forces”", locator: "Impulse" },
    ]);
    expect(text).toBe("Momentum is conserved [1]. It is p = mv [2][1]. Unknown.\n\nSources:\n[1] Notebook page “Forces”, Impulse\n[2] physics.pdf, p. 4");
  });
});
