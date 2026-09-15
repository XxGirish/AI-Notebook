export type PersistenceStatus = "loading" | "saving" | "saved" | "error";

export function canActivateAppUpdate(status: PersistenceStatus): boolean {
  return status === "saved";
}

export function hasUncommittedNotebookChanges(status: PersistenceStatus): boolean {
  return status === "saving" || status === "error";
}
