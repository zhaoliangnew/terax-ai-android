import { describe, expect, it } from "vitest";
import { repoLabel } from "./repoLabel";

describe("repoLabel", () => {
  it("names the main project for a worktree", () => {
    expect(repoLabel("/w/app-super/.worktree/wt_公共参数")).toEqual({
      project: "app-super",
      worktree: "wt_公共参数",
    });
  });

  it("uses the repo folder itself otherwise", () => {
    expect(repoLabel("/w/app-super/")).toEqual({
      project: "app-super",
      worktree: null,
    });
  });
});
