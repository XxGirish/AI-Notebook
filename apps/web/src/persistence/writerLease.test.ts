import { describe, expect, it, vi } from "vitest";
import { createWriterLease, type WriterLeaseStatus, type WriterLockManager } from "./writerLease";

// A small in-memory model of the Web Locks API for one exclusive lock:
// holding, FIFO waiting, ifAvailable probes, steal preemption, and abort signals.
function fakeLockManager() {
  const requests: string[] = [];
  let holder: symbol | undefined;
  let displaceHolder: (() => void) | undefined;
  const waiting: Array<() => void> = [];

  const pump = () => {
    if (!holder) waiting.shift()?.();
  };

  const manager: WriterLockManager = {
    request: (name, options, callback) => new Promise((resolve, reject) => {
      requests.push(options.steal ? "steal" : options.ifAvailable ? "probe" : "wait");
      const token = Symbol(name);
      const run = () => {
        holder = token;
        displaceHolder = () => reject(new DOMException(`Lock ${name} was stolen`, "AbortError"));
        callback({ name }).then(resolve, reject).finally(() => {
          if (holder !== token) return;
          holder = undefined;
          displaceHolder = undefined;
          pump();
        });
      };

      if (options.steal) {
        displaceHolder?.();
        run();
      } else if (!holder && waiting.length === 0) {
        run();
      } else if (options.ifAvailable) {
        callback(null).then(resolve, reject);
      } else {
        waiting.push(run);
        options.signal?.addEventListener("abort", () => {
          const index = waiting.indexOf(run);
          if (index < 0) return;
          waiting.splice(index, 1);
          reject(new DOMException("Lock request aborted", "AbortError"));
        });
      }
    }),
  };

  return { manager, requests, isHeld: () => holder !== undefined, waitingCount: () => waiting.length };
}

function trackedLease(manager: WriterLockManager, onGranted: () => Promise<void> = async () => undefined) {
  const statuses: WriterLeaseStatus[] = [];
  const lease = createWriterLease({ manager, onGranted, onStatus: (status) => statuses.push(status) });
  return { lease, statuses };
}

describe("single-writer lease", () => {
  it("opens read-only while another tab owns the lock, then becomes writable when it closes", async () => {
    const locks = fakeLockManager();
    const other = trackedLease(locks.manager);
    other.lease.start();
    await vi.waitFor(() => expect(other.statuses.at(-1)).toBe("writer"));

    const tab = trackedLease(locks.manager);
    tab.lease.start();
    await vi.waitFor(() => expect(tab.statuses).toEqual(["checking", "reader"]));

    other.lease.stop();
    await vi.waitFor(() => expect(tab.statuses).toEqual(["checking", "reader", "writer"]));
    expect(locks.requests).toEqual(["probe", "probe", "wait"]);
    tab.lease.stop();
  });

  it("becomes the writer after a remount races the previous mount's lock release", async () => {
    const locks = fakeLockManager();
    // Development StrictMode mounts, cleans up, and remounts synchronously.
    // The first mount's lock callback is still running when the second probes.
    const first = trackedLease(locks.manager);
    first.lease.start();
    first.lease.stop();
    const second = trackedLease(locks.manager);
    second.lease.start();

    await vi.waitFor(() => expect(second.statuses.at(-1)).toBe("writer"));
    expect(first.statuses).toEqual(["checking"]);
    second.lease.stop();
    await vi.waitFor(() => expect(locks.isHeld()).toBe(false));
  });

  it("hydrates current storage before exposing writable state", async () => {
    let finishHydration: (() => void) | undefined;
    const hydration = new Promise<void>((resolve) => { finishHydration = resolve; });
    const locks = fakeLockManager();
    const tab = trackedLease(locks.manager, () => hydration);
    tab.lease.start();
    await vi.waitFor(() => expect(tab.statuses).toEqual(["checking"]));
    finishHydration?.();
    await vi.waitFor(() => expect(tab.statuses).toEqual(["checking", "writer"]));
    tab.lease.stop();
  });

  it("uses explicit lock preemption only after a takeover action and abandons its queued wait", async () => {
    const locks = fakeLockManager();
    const other = trackedLease(locks.manager);
    other.lease.start();
    await vi.waitFor(() => expect(other.statuses.at(-1)).toBe("writer"));

    const tab = trackedLease(locks.manager);
    tab.lease.start();
    await vi.waitFor(() => expect(tab.statuses.at(-1)).toBe("reader"));
    expect(locks.waitingCount()).toBe(1);

    tab.lease.takeOver();
    await vi.waitFor(() => expect(tab.statuses.at(-1)).toBe("writer"));
    // The final wait belongs to the displaced tab, which queues to regain the lock later.
    expect(locks.requests.slice(1)).toEqual(["probe", "wait", "steal", "wait"]);
    expect(locks.waitingCount()).toBe(1);
    expect(tab.statuses.filter((status) => status === "writer")).toHaveLength(1);
    other.lease.stop();
    tab.lease.stop();
  });

  it("demotes a preempted holder and lets it regain the lock after the new writer closes", async () => {
    const locks = fakeLockManager();
    const displaced = trackedLease(locks.manager);
    displaced.lease.start();
    await vi.waitFor(() => expect(displaced.statuses.at(-1)).toBe("writer"));

    const thief = trackedLease(locks.manager);
    thief.lease.takeOver();
    await vi.waitFor(() => expect(thief.statuses.at(-1)).toBe("writer"));
    await vi.waitFor(() => expect(displaced.statuses.at(-1)).toBe("reader"));

    thief.lease.stop();
    await vi.waitFor(() => expect(displaced.statuses.at(-1)).toBe("writer"));
    displaced.lease.stop();
  });

  it("does not promote a holder whose lock was stolen during hydration", async () => {
    let finishHydration: (() => void) | undefined;
    const hydration = new Promise<void>((resolve) => { finishHydration = resolve; });
    const locks = fakeLockManager();
    const slow = trackedLease(locks.manager, () => hydration);
    slow.lease.start();
    await vi.waitFor(() => expect(slow.statuses).toEqual(["checking"]));

    const thief = trackedLease(locks.manager);
    thief.lease.takeOver();
    await vi.waitFor(() => expect(slow.statuses.at(-1)).toBe("reader"));
    finishHydration?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slow.statuses).not.toContain("writer");
    expect(thief.statuses.at(-1)).toBe("writer");
    slow.lease.stop();
    thief.lease.stop();
  });

  it("fails closed when the browser cannot provide cross-tab locks", () => {
    const statuses: WriterLeaseStatus[] = [];
    const lease = createWriterLease({ onGranted: async () => undefined, onStatus: (status) => statuses.push(status) });
    lease.start();
    expect(statuses).toEqual(["unsupported"]);
  });
});
