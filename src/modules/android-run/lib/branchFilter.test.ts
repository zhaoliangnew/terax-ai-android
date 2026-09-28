import { describe, expect, it } from "vitest";
import { branchSearchKey, matchesBranchQuery } from "./branchFilter";

const match = (name: string, q: string) =>
  matchesBranchQuery(branchSearchKey(name), q);

describe("matchesBranchQuery", () => {
  it("matches everything on an empty query", () => {
    expect(match("master", "")).toBe(true);
    expect(match("master", "   ")).toBe(true);
  });

  it("matches plain substrings case-insensitively", () => {
    expect(match("release_5.5.6.0", "5.5.6")).toBe(true);
    expect(match("Feature_2.0", "feature")).toBe(true);
    expect(match("master", "dev")).toBe(false);
  });

  it("matches Chinese text directly and by full pinyin", () => {
    expect(match("dz_内蒙古电力", "内蒙古")).toBe(true);
    expect(match("dz_内蒙古电力", "neimenggu")).toBe(true);
    expect(match("dz_内蒙古电力", "山东")).toBe(false);
  });

  it("matches pinyin initials", () => {
    expect(match("dz_内蒙古电力", "nmg")).toBe(true);
    expect(match("dz_陕西国网", "sxgw")).toBe(true);
    expect(match("dz_陕西国网", "nmg")).toBe(false);
  });
});
