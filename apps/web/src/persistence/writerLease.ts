export type WriterLeaseStatus = "checking" | "writer" | "reader" | "unsupported";

type LockRequestOptions = { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal };
type LockLike = { name: string };

export type WriterLockManager = {
  request: (
    name: string,
    options: LockRequestOptions,
    callback: (lock: LockLike | null) => Promise<void>,
  ) => Promise<unknown>;
};

type WriterLeaseOptions = {
  manager?: WriterLockManager;
  onGranted: () => Promise<void>;
  onStatus: (status: WriterLeaseStatus) => void;
};

type AcquireMode = "probe" | "wait" | "steal";

const WRITER_LOCK_NAME = "ai-notebook-writer";

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export function createWriterLease({ manager, onGranted, onStatus }: WriterLeaseOptions) {
  let stopped = false;
  let generation = 0;
  let releaseHeldLock: (() => void) | undefined;
  let pendingWait: AbortController | undefined;

  const cancelPendingWait = () => {
    pendingWait?.abort();
    pendingWait = undefined;
  };

  const acquire = (lockManager: WriterLockManager, mode: AcquireMode, requestGeneration: number) => {
    const isCurrent = () => !stopped && requestGeneration === generation;
    let granted = false;
    let displaced = false;
    let release: (() => void) | undefined;
    let options: LockRequestOptions;
    if (mode === "steal") {
      options = { steal: true };
    } else if (mode === "probe") {
      options = { ifAvailable: true };
    } else {
      pendingWait = new AbortController();
      options = { signal: pendingWait.signal };
    }

    void lockManager.request(WRITER_LOCK_NAME, options, async (lock) => {
      if (!isCurrent()) return;
      if (!lock) {
        onStatus("reader");
        // Stay queued so this tab becomes writable once the lock is actually
        // free: the editing tab closed, or a previous mount of this tab (for
        // example a development remount) finished releasing it.
        if (mode === "probe") acquire(lockManager, "wait", requestGeneration);
        return;
      }

      granted = true;
      if (mode === "wait") pendingWait = undefined;
      await onGranted();
      if (displaced || !isCurrent()) return;
      onStatus("writer");
      await new Promise<void>((resolve) => {
        release = resolve;
        releaseHeldLock = resolve;
      });
    }).then(
      () => {
        if (!displaced && isCurrent() && granted) onStatus("reader");
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        // A takeover rejects the displaced holder's request. Its callback may
        // still be running, so the UI must become read-only immediately and
        // must not be promoted again when that callback finishes.
        displaced = true;
        if (releaseHeldLock === release) releaseHeldLock = undefined;
        release?.();
        onStatus("reader");
        if (granted && isAbortError(error)) acquire(lockManager, "wait", requestGeneration);
      },
    );
  };

  const request = (mode: "probe" | "steal") => {
    if (!manager) {
      onStatus("unsupported");
      return;
    }

    const requestGeneration = ++generation;
    cancelPendingWait();
    onStatus("checking");
    acquire(manager, mode, requestGeneration);
  };

  return {
    start: () => request("probe"),
    takeOver: () => request("steal"),
    stop: () => {
      stopped = true;
      generation += 1;
      cancelPendingWait();
      releaseHeldLock?.();
      releaseHeldLock = undefined;
    },
  };
}
