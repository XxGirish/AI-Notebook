import { describe, expect, it } from "vitest";
import { canActivateAppUpdate, hasUncommittedNotebookChanges } from "./updatePolicy";

describe("application update safety", () => {
  it("allows activation only after persistence has completed", () => {
    expect(canActivateAppUpdate("saved")).toBe(true);
    expect(canActivateAppUpdate("loading")).toBe(false);
    expect(canActivateAppUpdate("saving")).toBe(false);
    expect(canActivateAppUpdate("error")).toBe(false);
  });

  it("warns before leaving only when local changes may be uncommitted", () => {
    expect(hasUncommittedNotebookChanges("saving")).toBe(true);
    expect(hasUncommittedNotebookChanges("error")).toBe(true);
    expect(hasUncommittedNotebookChanges("loading")).toBe(false);
    expect(hasUncommittedNotebookChanges("saved")).toBe(false);
  });
});
