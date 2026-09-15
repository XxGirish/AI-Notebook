import { describe, expect, it, vi } from "vitest";
import { createWriterLease, type WriterLeaseStatus, type WriterLockManager } from "./writerLease";

function managerWith(results: Array<"grant" | "busy">) {
  const options: Array<{ ifAvailable?: boolean; steal?: boolean }> = [];
  const manager: WriterLockManager = {
    request: async (name, requestOptions, callback) => {
      options.push(requestOptions);
      const result = results.shift() ?? "busy";
      await callback(result === "grant" ? { name } : null);
    },
  };
  return { manager, options };
}

describe("single-writer lease", () => {
  it("opens read-only when another tab already owns the lock", async () => {
    const statuses: WriterLeaseStatus[] = [];
    const { manager } = managerWith(["busy"]);
    const lease = createWriterLease({ manager, onGranted: vi.fn(), onStatus: (status) => statuses.push(status) });
    lease.start();
    await vi.waitFor(() => expect(statuses).toEqual(["checking", "reader"]));
  });

  it("hydrates current storage before exposing writable state", async () => {
    const statuses: WriterLeaseStatus[] = [];
    let finishHydration: (() => void) | undefined;
    const hydration = new Promise<void>((resolve) => { finishHydration = resolve; });
    const { manager } = managerWith(["grant"]);
    const lease = createWriterLease({ manager, onGranted: () => hydration, onStatus: (status) => statuses.push(status) });
    lease.start();
    await vi.waitFor(() => expect(statuses).toEqual(["checking"]));
    finishHydration?.();
    await vi.waitFor(() => expect(statuses).toEqual(["checking", "writer"]));
    lease.stop();
  });

  it("uses explicit lock preemption only after a takeover action", async () => {
    const statuses: WriterLeaseStatus[] = [];
    const { manager, options } = managerWith(["busy", "grant"]);
    const lease = createWriterLease({ manager, onGranted: async () => undefined, onStatus: (status) => statuses.push(status) });
    lease.start();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("reader"));
    lease.takeOver();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("writer"));
    expect(options).toEqual([{ ifAvailable: true }, { steal: true }]);
    lease.stop();
  });

  it("demotes a holder when another tab preempts its lock", async () => {
    const statuses: WriterLeaseStatus[] = [];
    let preempt: (() => void) | undefined;
    const manager: WriterLockManager = {
      request: (name, _options, callback) => new Promise((_resolve, reject) => {
        preempt = () => reject(new DOMException(`Lock ${name} was stolen`, "AbortError"));
        void callback({ name });
      }),
    };
    const lease = createWriterLease({ manager, onGranted: async () => undefined, onStatus: (status) => statuses.push(status) });
    lease.start();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("writer"));
    preempt?.();
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("reader"));
    lease.stop();
  });

  it("fails closed when the browser cannot provide cross-tab locks", () => {
    const statuses: WriterLeaseStatus[] = [];
    const lease = createWriterLease({ onGranted: async () => undefined, onStatus: (status) => statuses.push(status) });
    lease.start();
    expect(statuses).toEqual(["unsupported"]);
  });
});
