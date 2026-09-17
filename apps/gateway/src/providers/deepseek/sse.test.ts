import { describe, expect, it } from "vitest";
import { streamOf } from "../../testSupport";
import { readSseData } from "./sse";

async function collect(chunks: Array<string | Uint8Array>) {
  const events: string[] = [];
  for await (const data of readSseData(streamOf(chunks))) events.push(data);
  return events;
}

describe("SSE reader", () => {
  it("joins fragmented events and skips keep-alive comments and blank waiting lines", async () => {
    expect(await collect([": keep-alive\n\n", "\n", "da", "ta: {\"a\":", "1}\n", "\n", "data: [DONE]\n\n"])).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("handles CRLF split across chunks, multi-line data, and a final unterminated event", async () => {
    expect(await collect(["data: one\r", "\n\r\n", "data: two\ndata: lines\n\n", "data: last"])).toEqual(["one", "two\nlines", "last"]);
  });

  it("decodes a UTF-8 character split between chunks", async () => {
    const bytes = new TextEncoder().encode("data: café\n\n");
    expect(await collect([bytes.slice(0, 10), bytes.slice(10)])).toEqual(["café"]);
  });
});
