/**
 * Reads Server-Sent Events and yields each event's joined `data` payload.
 * Comment lines (DeepSeek keep-alives such as `: keep-alive`) and blank
 * waiting lines are skipped. Chunk boundaries may fall anywhere, including
 * inside a UTF-8 character or between `\r` and `\n`.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const takeLine = (line: string): string | undefined => {
    if (line === "") {
      if (dataLines.length === 0) return undefined;
      const data = dataLines.join("\n");
      dataLines = [];
      return data;
    }
    if (line.startsWith(":")) return undefined;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    return undefined;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.search(/\r\n|\r|\n/);
      // A trailing lone `\r` may be the first half of `\r\n`; wait for more input.
      while (newline >= 0 && !(buffer[newline] === "\r" && newline === buffer.length - 1)) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        const data = takeLine(line);
        if (data !== undefined) yield data;
        newline = buffer.search(/\r\n|\r|\n/);
      }
    }
    if (buffer.length > 0) {
      const data = takeLine(buffer.replace(/\r$/, ""));
      if (data !== undefined) yield data;
    }
    const trailing = takeLine("");
    if (trailing !== undefined) yield trailing;
  } finally {
    reader.releaseLock();
  }
}
