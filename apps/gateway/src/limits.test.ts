import { describe, expect, it } from "vitest";
import { GenerationLimiter } from "./limits";

describe("generation limiter", () => {
  it("allows one in-flight generation and rejects reused request IDs", () => {
    const limiter = new GenerationLimiter({ requestsPerMinute: 10, dailyRequests: 10, dailyTokens: 10_000, now: () => 0 });
    const first = limiter.admit("request-a");
    expect(first.ok).toBe(true);
    expect(limiter.admit("request-b")).toMatchObject({ ok: false, code: "busy" });
    if (first.ok) first.release(10);
    expect(limiter.admit("request-a")).toMatchObject({ ok: false, code: "duplicate_request", status: 409 });
  });

  it("enforces the per-minute window and daily request and token budgets", () => {
    let now = Date.UTC(2026, 8, 17, 10);
    const limiter = new GenerationLimiter({ requestsPerMinute: 2, dailyRequests: 3, dailyTokens: 100, now: () => now });
    const admitAndRelease = (id: string, tokens = 0) => {
      const admission = limiter.admit(id);
      if (admission.ok) admission.release(tokens);
      return admission;
    };
    expect(admitAndRelease("r1").ok).toBe(true);
    expect(admitAndRelease("r2").ok).toBe(true);
    expect(admitAndRelease("r3")).toMatchObject({ code: "rate_limited" });
    now += 61_000;
    expect(admitAndRelease("r4", 150).ok).toBe(true);
    now += 61_000;
    expect(admitAndRelease("r5")).toMatchObject({ code: "budget_exhausted" });
    now = Date.UTC(2026, 8, 18, 0, 1);
    expect(admitAndRelease("r6").ok).toBe(true);
  });
});
