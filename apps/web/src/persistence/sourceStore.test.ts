import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  clearChatMessages,
  deleteSource,
  findSourceByHash,
  loadChatMessages,
  loadSourceChunks,
  loadSources,
  saveChatMessage,
  setSourceEnabled,
  storeSource,
  type SourceRecord,
} from "./notebookDatabase";

const source: SourceRecord = {
  id: "source-1", name: "notes.pdf", kind: "pdf", size: 10, contentHash: "abc", pageCount: 2,
  chunkCount: 2, characterCount: 20, enabled: true, addedAt: 1,
};

describe("source and chat storage (database version 5)", () => {
  it("stores a source with its passages, finds it by hash, toggles it, and removes both together", async () => {
    await storeSource(source, [
      { id: "source-1:0", sourceId: "source-1", ordinal: 0, page: 1, text: "first" },
      { id: "source-1:1", sourceId: "source-1", ordinal: 1, page: 2, text: "second" },
    ]);
    expect((await findSourceByHash("abc"))?.id).toBe("source-1");
    expect(await loadSourceChunks()).toHaveLength(2);

    await setSourceEnabled("source-1", false);
    expect((await loadSources())[0].enabled).toBe(false);

    await deleteSource("source-1");
    expect(await loadSources()).toHaveLength(0);
    expect(await loadSourceChunks()).toHaveLength(0);
  });

  it("refuses a duplicate passage id without keeping the half-added source", async () => {
    const chunk = { id: "source-2:0", sourceId: "source-2", ordinal: 0, text: "same" };
    await expect(storeSource({ ...source, id: "source-2", contentHash: "def" }, [chunk, chunk])).rejects.toThrow();
    expect(await findSourceByHash("def")).toBeUndefined();
  });

  it("keeps chat history in order and clears it", async () => {
    await saveChatMessage({ id: "m2", role: "assistant", content: "answer", createdAt: 2 });
    await saveChatMessage({ id: "m1", role: "user", content: "question", createdAt: 1 });
    expect((await loadChatMessages()).map((message) => message.id)).toEqual(["m1", "m2"]);
    await clearChatMessages();
    expect(await loadChatMessages()).toHaveLength(0);
  });
});
