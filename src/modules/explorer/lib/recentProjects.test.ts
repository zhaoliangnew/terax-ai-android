import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupRecentProjects,
  loadRecentProjects,
  RECENT_MAX,
  recentProjectInfo,
  touchRecentProject,
} from "./recentProjects";

// 测试跑在 node 里,没有真的 localStorage —— 塞一个内存版进去。
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

describe("recentProjects", () => {
  beforeEach(() => store.clear());

  it("moves the touched path to the front and persists it", () => {
    let list = touchRecentProject([], "/w/a/app_bind");
    list = touchRecentProject(list, "/w/b/app_super/");
    list = touchRecentProject(list, "/w/a/app_bind");
    expect(list).toEqual(["/w/a/app_bind", "/w/b/app_super"]);
    expect(loadRecentProjects()).toEqual(list);
  });

  it("returns the same list when the path is already first", () => {
    const list = touchRecentProject([], "/w/a");
    expect(touchRecentProject(list, "/w/a")).toBe(list);
  });

  it("keeps at most RECENT_MAX entries", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i++)
      list = touchRecentProject(list, `/w/p${i}`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe(`/w/p${RECENT_MAX + 2}`);
  });

  it("hints the parent folder, or the main project for a worktree", () => {
    expect(recentProjectInfo("/w/2.0-南航/app_bind")).toEqual({
      name: "app_bind",
      hint: "2.0-南航",
      isWorktree: false,
      mainRoot: null,
    });
    expect(
      recentProjectInfo(
        "/w/workspace_5.0/app_kitchen_gateway/.worktree/release_4g流量",
      ),
    ).toEqual({
      name: "release_4g流量",
      hint: "workspace_5.0 / app_kitchen_gateway",
      isWorktree: true,
      mainRoot: "/w/workspace_5.0/app_kitchen_gateway",
    });
  });

  it("groups folder → product → worktree, newest first at every level", () => {
    const wt = (n: string) => `/w/std/app_food/.worktree/${n}`;
    expect(
      groupRecentProjects([
        wt("release_a"),
        "/w/nanjing/app_bind",
        "/w/std/app_cheng",
        "/w/std/app_food",
        wt("release_b"),
      ]),
    ).toEqual([
      {
        folder: "/w/std",
        products: [
          {
            root: "/w/std/app_food",
            worktrees: [wt("release_a"), wt("release_b")],
          },
          { root: "/w/std/app_cheng", worktrees: [] },
        ],
      },
      {
        folder: "/w/nanjing",
        products: [{ root: "/w/nanjing/app_bind", worktrees: [] }],
      },
    ]);
  });
});
