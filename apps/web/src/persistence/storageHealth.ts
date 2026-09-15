export type StorageEstimateLike = { usage?: number; quota?: number };

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

export function formatStorageEstimate(estimate: StorageEstimateLike): string | undefined {
  const usage = typeof estimate.usage === "number" && Number.isFinite(estimate.usage) ? Math.max(0, estimate.usage) : undefined;
  const quota = typeof estimate.quota === "number" && Number.isFinite(estimate.quota) && estimate.quota > 0 ? estimate.quota : undefined;
  if (usage === undefined) return undefined;
  if (quota === undefined) return `Local storage: ${formatBytes(usage)} used`;
  return `Local storage: ${formatBytes(usage)} of ${formatBytes(quota)} used`;
}

export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22 || candidate.code === 1014;
}

export function storageFailureMessage(error: unknown): string {
  if (isQuotaExceededError(error)) return "Storage is full. Export a backup, free browser storage, then try saving again.";
  return "Local storage failed. Your latest change is not marked as saved; export a backup before closing this tab.";
}
