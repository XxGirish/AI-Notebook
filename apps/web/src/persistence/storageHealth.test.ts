import { describe, expect, it } from "vitest";
import { formatStorageEstimate, isQuotaExceededError, storageFailureMessage } from "./storageHealth";

describe("storage health", () => {
  it("formats available origin usage without treating unavailable values as zero", () => {
    expect(formatStorageEstimate({ usage: 2 * 1024 ** 2, quota: 10 * 1024 ** 2 })).toBe("Local storage: 2.0 MB of 10.0 MB used");
    expect(formatStorageEstimate({ usage: 512 })).toBe("Local storage: 512 B used");
    expect(formatStorageEstimate({ quota: 100 })).toBeUndefined();
  });

  it("recognizes named and legacy quota failures", () => {
    expect(isQuotaExceededError({ name: "QuotaExceededError" })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError(new Error("disk failed"))).toBe(false);
  });

  it("provides a specific recovery path for full storage", () => {
    expect(storageFailureMessage({ name: "QuotaExceededError" })).toMatch(/Storage is full.*Export a backup/);
    expect(storageFailureMessage(new Error("offline database"))).toMatch(/not marked as saved/);
  });
});
