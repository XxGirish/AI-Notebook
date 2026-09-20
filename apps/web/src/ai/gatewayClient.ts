import type { GatewayCapabilities, GatewayErrorCode, GatewayEvent, GenerateRequest } from "@ai-notebook/ai-contract";

/**
 * The browser half of the gateway protocol. It only transports events: every
 * proposal it yields is still untrusted and is validated against the page
 * before anything is committed.
 */

export type GatewayClientOptions = {
  /** Same-origin by default; the DeepSeek key never reaches this process. */
  baseUrl?: string;
  /**
   * Optional shared token for a personal deployment. Anything sent from the
   * browser is readable by whoever can open the app, so this protects the
   * gateway from other people on a network, not the DeepSeek key.
   */
  accessToken?: string;
  fetchImpl?: typeof fetch;
};

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: GatewayErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}

const MESSAGES: Partial<Record<GatewayErrorCode, string>> = {
  unauthorized: "This notebook is not allowed to use the gateway. Check its access token.",
  busy: "The gateway is already working on another request. Try again in a moment.",
  rate_limited: "Too many requests in the last minute. Try again shortly.",
  budget_exhausted: "Today's request budget is used up.",
  provider_auth: "The gateway's DeepSeek credentials were rejected.",
  provider_balance: "The DeepSeek account has no balance left.",
  provider_rate_limited: "DeepSeek is rate limiting this account. Try again shortly.",
  provider_unavailable: "The model could not be reached.",
  truncated: "The answer was cut off before it was complete.",
  refused: "The model declined this request.",
  empty_output: "The model returned nothing.",
  invalid_proposal: "The model's answer did not fit the notebook's format.",
  timeout: "The request took too long and was stopped.",
  request_too_large: "The selected context is too large to send.",
};

/** Turns a gateway error code into something worth showing on the canvas. */
export function describeGatewayError(code: GatewayErrorCode, fallback: string) {
  return MESSAGES[code] ?? fallback;
}

const join = (baseUrl: string | undefined, path: string) => (baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path);

function headers(options: GatewayClientOptions, contentType?: string) {
  const value: Record<string, string> = {};
  if (contentType) value["Content-Type"] = contentType;
  if (options.accessToken) value.Authorization = `Bearer ${options.accessToken}`;
  return value;
}

async function errorFromResponse(response: Response): Promise<GatewayError> {
  const body = (await response.json().catch(() => undefined)) as
    | { code?: GatewayErrorCode; message?: string; retryable?: boolean }
    | undefined;
  if (body?.code) {
    return new GatewayError(body.code, describeGatewayError(body.code, body.message ?? `The gateway returned ${response.status}.`), body.retryable ?? false);
  }
  // No gateway error body: the gateway itself did not answer. A development
  // proxy or a reverse proxy reports that as a 5xx, and it is worth retrying
  // once the gateway is running again. This is not a DeepSeek failure, and
  // saying so would send the reader looking in the wrong place.
  if (response.status === 401) {
    return new GatewayError("unauthorized", describeGatewayError("unauthorized", "Unauthorized"), false);
  }
  return new GatewayError(
    "provider_unavailable",
    `The gateway did not answer (${response.status}). Check that it is running.`,
    response.status >= 500,
  );
}

export async function fetchCapabilities(options: GatewayClientOptions = {}): Promise<GatewayCapabilities> {
  const call = options.fetchImpl ?? fetch;
  const response = await call(join(options.baseUrl, "/api/ai/capabilities"), { headers: headers(options) });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as GatewayCapabilities;
}

/**
 * Parses one `text/event-stream` chunk at a time. Keep-alive comment lines and
 * events without data are skipped; malformed data ends the stream rather than
 * being guessed at.
 */
export function createSseParser(onEvent: (eventName: string, data: string) => void) {
  let buffer = "";

  const flush = (block: string) => {
    let eventName = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":") || line.length === 0) continue;
      const separator = line.indexOf(":");
      const field = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "event") eventName = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) onEvent(eventName, data.join("\n"));
  };

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        flush(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim().length > 0) flush(buffer);
      buffer = "";
    },
  };
}

const GATEWAY_EVENT_TYPES = new Set(["started", "progress", "proposal", "usage", "complete", "error"]);

function parseGatewayEvent(data: string): GatewayEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new GatewayError("invalid_proposal", "The gateway sent an event that could not be read.", true);
  }
  if (typeof value !== "object" || value === null) return undefined;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !GATEWAY_EVENT_TYPES.has(type)) return undefined;
  return value as GatewayEvent;
}

export type StreamGenerationOptions = GatewayClientOptions & {
  signal?: AbortSignal;
  onEvent: (event: GatewayEvent) => void;
};

/**
 * Streams one generation. Resolves when the gateway closes the stream; the
 * caller reads the outcome from the events it received.
 */
export async function streamGeneration(request: GenerateRequest, options: StreamGenerationOptions): Promise<void> {
  const call = options.fetchImpl ?? fetch;
  const response = await call(join(options.baseUrl, "/api/ai/generate"), {
    method: "POST",
    headers: headers(options, "application/json"),
    body: JSON.stringify(request),
    signal: options.signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new GatewayError("provider_unavailable", "The gateway returned no stream.", true);

  const parser = createSseParser((_eventName, data) => {
    const event = parseGatewayEvent(data);
    if (event) options.onEvent(event);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    // An aborted stream leaves the gateway's reader open unless it is released.
    reader.cancel().catch(() => undefined);
  }
}

/**
 * Asks the gateway to stop a generation. Aborting the stream alone leaves the
 * provider call running, which still spends tokens.
 */
export async function cancelGeneration(requestId: string, options: GatewayClientOptions = {}): Promise<boolean> {
  const call = options.fetchImpl ?? fetch;
  try {
    const response = await call(join(options.baseUrl, "/api/ai/cancel"), {
      method: "POST",
      headers: headers(options, "application/json"),
      body: JSON.stringify({ requestId }),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { cancelled?: boolean };
    return body.cancelled === true;
  } catch {
    return false;
  }
}
