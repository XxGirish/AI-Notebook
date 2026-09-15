export type WriterLeaseStatus = "checking" | "writer" | "reader" | "unsupported";

type LockRequestOptions = { ifAvailable?: boolean; steal?: boolean };
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

const WRITER_LOCK_NAME = "ai-notebook-writer";

export function createWriterLease({ manager, onGranted, onStatus }: WriterLeaseOptions) {
  let stopped = false;
  let generation = 0;
  let releaseHeldLock: (() => void) | undefined;

  const request = (steal: boolean) => {
    if (!manager) {
      onStatus("unsupported");
      return;
    }

    const requestGeneration = ++generation;
    onStatus("checking");
    let granted = false;
    const options: LockRequestOptions = steal ? { steal: true } : { ifAvailable: true };

    void manager.request(WRITER_LOCK_NAME, options, async (lock) => {
      if (stopped || requestGeneration !== generation) return;
      if (!lock) {
        onStatus("reader");
        return;
      }

      granted = true;
      await onGranted();
      if (stopped || requestGeneration !== generation) return;
      onStatus("writer");
      await new Promise<void>((resolve) => {
        releaseHeldLock = resolve;
      });
    }).then(
      () => {
        if (!stopped && granted && requestGeneration === generation) onStatus("reader");
      },
      () => {
        // A takeover rejects the displaced holder's request. Its callback may
        // still be running, so the UI must become read-only immediately.
        if (!stopped && requestGeneration === generation) onStatus("reader");
      },
    );
  };

  return {
    start: () => request(false),
    takeOver: () => request(true),
    stop: () => {
      stopped = true;
      generation += 1;
      releaseHeldLock?.();
      releaseHeldLock = undefined;
    },
  };
}
