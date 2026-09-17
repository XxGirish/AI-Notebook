import type { GatewayErrorCode } from "@ai-notebook/ai-contract";

export type LimiterOptions = {
  requestsPerMinute: number;
  dailyRequests: number;
  dailyTokens: number;
  now?: () => number;
};

export type Admission =
  | { ok: true; release: (billedTokens: number) => void }
  | { ok: false; code: GatewayErrorCode; message: string; status: 409 | 429 };

const MINUTE_MS = 60_000;
const REQUEST_ID_RETENTION_MS = 24 * 60 * 60_000;
const MAX_REMEMBERED_REQUEST_IDS = 5_000;

/**
 * In-memory limits for one personal gateway process: a single in-flight
 * generation, a per-minute request window, daily request/token budgets, and
 * rejection of reused request IDs. Counters reset when the process restarts,
 * so they bound accidental loops rather than guaranteeing a spend ceiling.
 */
export class GenerationLimiter {
  private inFlight = false;
  private recentStarts: number[] = [];
  private day = "";
  private dayRequests = 0;
  private dayTokens = 0;
  private readonly seenRequestIds = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: LimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  admit(requestId: string): Admission {
    const now = this.now();
    this.rollDay(now);
    this.forgetOldRequestIds(now);

    if (this.seenRequestIds.has(requestId)) {
      return { ok: false, code: "duplicate_request", message: "This request ID was already used; start a new request to generate again", status: 409 };
    }
    if (this.inFlight) {
      return { ok: false, code: "busy", message: "Another generation is already running", status: 429 };
    }
    this.recentStarts = this.recentStarts.filter((start) => now - start < MINUTE_MS);
    if (this.recentStarts.length >= this.options.requestsPerMinute) {
      return { ok: false, code: "rate_limited", message: "Too many generations in the last minute", status: 429 };
    }
    if (this.dayRequests >= this.options.dailyRequests || this.dayTokens >= this.options.dailyTokens) {
      return { ok: false, code: "budget_exhausted", message: "The gateway's daily AI budget is used up", status: 429 };
    }

    this.inFlight = true;
    this.recentStarts.push(now);
    this.dayRequests += 1;
    this.seenRequestIds.set(requestId, now);
    let released = false;
    const admittedDay = this.day;
    return {
      ok: true,
      release: (billedTokens) => {
        if (released) return;
        released = true;
        this.inFlight = false;
        this.rollDay(this.now());
        if (this.day === admittedDay) this.dayTokens += Math.max(0, billedTokens);
      },
    };
  }

  private rollDay(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day === this.day) return;
    this.day = day;
    this.dayRequests = 0;
    this.dayTokens = 0;
  }

  private forgetOldRequestIds(now: number) {
    for (const [id, seenAt] of this.seenRequestIds) {
      if (now - seenAt < REQUEST_ID_RETENTION_MS && this.seenRequestIds.size <= MAX_REMEMBERED_REQUEST_IDS) break;
      this.seenRequestIds.delete(id);
    }
  }
}
