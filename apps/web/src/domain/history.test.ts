import { describe, expect, it } from "vitest";
import { commitHistory, createHistory, redoHistory, undoHistory } from "./history";

describe("document history", () => {
  it("undoes and redoes one committed operation", () => {
    const initial = createHistory(["fixture"]);
    const committed = commitHistory(initial, ["fixture", "stroke"]);
    expect(undoHistory(committed).present).toEqual(["fixture"]);
    expect(redoHistory(undoHistory(committed)).present).toEqual(["fixture", "stroke"]);
  });

  it("clears redo history after a new branch", () => {
    const first = commitHistory(createHistory(["a"]), ["a", "b"]);
    const branched = commitHistory(undoHistory(first), ["a", "c"]);
    expect(branched.future).toEqual([]);
  });
});

