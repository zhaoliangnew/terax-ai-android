import { describe, expect, it, vi } from "vitest";

// 只测纯函数;候选列表要走 git/文件系统,这里不需要
vi.mock("./lib/workitemLaunch", () => ({ listRepoCandidates: vi.fn() }));

const { groupRepoCandidates, repoName } = await import("./WorkitemRepoPicker");

type C = Parameters<typeof groupRepoCandidates>[0][number];

const cands: C[] = [
  { path: "/p/0.2.0/app_cheng", name: "app_cheng", group: "product" },
  { path: "/p/0.2.0/app_zizhu", name: "app_zizhu", group: "recent" },
  { path: "/p/0.2.0/app_shouchi", name: "app_shouchi", group: "current" },
  { path: "/p/0.2.0/lib_print", name: "lib_print", group: "product" },
];

describe("repoName", () => {
  it("takes the last path segment", () => {
    expect(repoName("/a/b/app_cheng")).toBe("app_cheng");
  });

  it("ignores trailing slashes", () => {
    expect(repoName("/a/b/app_cheng//")).toBe("app_cheng");
  });

  it("handles Windows paths", () => {
    expect(repoName("C:\\work\\app_cheng\\")).toBe("app_cheng");
  });

  it("falls back to the input when there is no separator", () => {
    expect(repoName("app_cheng")).toBe("app_cheng");
    expect(repoName("/")).toBe("/");
  });
});

describe("groupRepoCandidates", () => {
  it("orders groups recent, current, product and drops empty ones", () => {
    const g = groupRepoCandidates(cands, "");
    expect(g.map((x) => x.key)).toEqual(["recent", "current", "product"]);
    expect(g.map((x) => x.label)).toEqual([
      "最近用过",
      "当前工程",
      "产品目录下",
    ]);
    expect(g[2].items.map((c) => c.name)).toEqual(["app_cheng", "lib_print"]);
  });

  it("filters by name or path, case-insensitive, trimming the query", () => {
    const g = groupRepoCandidates(cands, "  PRINT ");
    expect(g).toHaveLength(1);
    expect(g[0].items.map((c) => c.name)).toEqual(["lib_print"]);
    expect(groupRepoCandidates(cands, "0.2.0/app_z")[0].items[0].name).toBe(
      "app_zizhu",
    );
  });

  it("first item of the first group is what Enter picks", () => {
    const g = groupRepoCandidates(cands, "app_");
    expect(g[0].items[0].name).toBe("app_zizhu");
  });

  it("returns nothing when no candidate matches", () => {
    expect(groupRepoCandidates(cands, "nope")).toEqual([]);
    expect(groupRepoCandidates([], "")).toEqual([]);
  });
});
