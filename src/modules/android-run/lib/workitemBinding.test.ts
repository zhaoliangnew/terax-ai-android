import type { GitBranchEntry } from "@/modules/ai/lib/native";
import { describe, expect, it } from "vitest";
import {
  mainRepoRoot,
  parseBindings,
  taskBranchState,
  taskWorktreeBranch,
} from "./workitemBinding";

describe("mainRepoRoot", () => {
  it("keeps a main repo path as is", () => {
    expect(mainRepoRoot("/Users/me/0.2.0/app_cheng")).toBe(
      "/Users/me/0.2.0/app_cheng",
    );
  });

  it("strips trailing slashes", () => {
    expect(mainRepoRoot("/Users/me/app_cheng/")).toBe("/Users/me/app_cheng");
    expect(mainRepoRoot("/Users/me/app_cheng///")).toBe("/Users/me/app_cheng");
  });

  it("maps a .worktree/<name> child back to the main repo", () => {
    expect(
      mainRepoRoot("/Users/me/app_cheng/.worktree/worktree_YOEZ-402"),
    ).toBe("/Users/me/app_cheng");
    expect(
      mainRepoRoot("/Users/me/app_cheng/.worktree/worktree_YOEZ-402/"),
    ).toBe("/Users/me/app_cheng");
  });

  it("maps a subfolder inside a task worktree back to the same subfolder", () => {
    // 工程在大仓库子目录里时,任务 worktree 从 git 根建,开发目录在它下面一层
    expect(mainRepoRoot("/w/mono/.worktree/worktree_YOEZ-402/android")).toBe(
      "/w/mono/android",
    );
    expect(mainRepoRoot("/Users/me/app/.worktree/x/module")).toBe(
      "/Users/me/app/module",
    );
  });

  it("normalizes backslashes", () => {
    expect(mainRepoRoot("C:\\work\\app_cheng\\")).toBe("C:/work/app_cheng");
    expect(mainRepoRoot("C:\\work\\app_cheng\\.worktree\\worktree_A-1")).toBe(
      "C:/work/app_cheng",
    );
  });

  it("leaves unrelated paths alone", () => {
    expect(mainRepoRoot("/Users/me/worktree/app")).toBe(
      "/Users/me/worktree/app",
    );
    expect(mainRepoRoot("/Users/me/app/.worktree")).toBe(
      "/Users/me/app/.worktree",
    );
    expect(mainRepoRoot("/Users/me/app/.worktrees/x")).toBe(
      "/Users/me/app/.worktrees/x",
    );
  });

  it("handles empty and root input", () => {
    expect(mainRepoRoot("")).toBe("");
    expect(mainRepoRoot("   ")).toBe("");
    expect(mainRepoRoot("/")).toBe("/");
  });
});

const good = {
  repoRoot: "/Users/me/app_cheng",
  serialNumber: "YOEZ-402",
  subject: "打印小票",
  projectId: "p1",
  category: "Task",
  boundAt: 100,
};

describe("parseBindings", () => {
  it("returns an empty map for missing or broken JSON", () => {
    expect(parseBindings(null)).toEqual({});
    expect(parseBindings("")).toEqual({});
    expect(parseBindings("{not json")).toEqual({});
    expect(parseBindings("[1,2]")).toEqual({});
    expect(parseBindings('"str"')).toEqual({});
    expect(parseBindings("null")).toEqual({});
  });

  it("keeps valid entries and drops broken ones", () => {
    const raw = JSON.stringify({
      a: good,
      b: { ...good, category: "Bug" },
      c: { ...good, repoRoot: "" },
      d: "oops",
      e: null,
      f: [good],
    });
    expect(Object.keys(parseBindings(raw))).toEqual(["a"]);
    expect(parseBindings(raw).a).toEqual(good);
  });

  it("normalizes repoRoot to the main repo", () => {
    const raw = JSON.stringify({
      a: { ...good, repoRoot: "C:\\w\\app\\.worktree\\worktree_X\\" },
    });
    expect(parseBindings(raw).a.repoRoot).toBe("C:/w/app");
  });

  it("fills missing optional fields tolerantly", () => {
    const raw = JSON.stringify({
      a: {
        repoRoot: "/r",
        category: "Req",
        boundAt: "yesterday",
        launchedAt: Number.NaN,
        worktreePath: "/r/.worktree/worktree_A/",
      },
    });
    expect(parseBindings(raw).a).toEqual({
      repoRoot: "/r",
      serialNumber: "",
      subject: "",
      projectId: "",
      category: "Req",
      boundAt: 0,
      worktreePath: "/r/.worktree/worktree_A",
    });
  });

  it("ignores a __proto__ key", () => {
    const raw = `{"__proto__": ${JSON.stringify(good)}, "a": ${JSON.stringify(good)}}`;
    const out = parseBindings(raw);
    expect(Object.keys(out)).toEqual(["a"]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe("taskWorktreeBranch", () => {
  it("keeps an ASCII serial", () => {
    expect(taskWorktreeBranch("YOEZ-402")).toBe("worktree_YOEZ-402");
    expect(taskWorktreeBranch(" YOEZ-402 ")).toBe("worktree_YOEZ-402");
  });

  it("replaces anything git or Windows paths dislike", () => {
    expect(taskWorktreeBranch("需求 12")).toBe("worktree__12");
    expect(taskWorktreeBranch("a/b:c*d?")).toBe("worktree_a_b_c_d_");
    expect(taskWorktreeBranch("a..b")).toBe("worktree_a_b");
    expect(taskWorktreeBranch("x.lock")).toBe("worktree_x");
    expect(taskWorktreeBranch("x.")).toBe("worktree_x");
  });

  it("never returns a bare prefix", () => {
    expect(taskWorktreeBranch("")).toBe("worktree_task");
    expect(taskWorktreeBranch("...")).toBe("worktree__");
  });
});

function entry(p: Partial<GitBranchEntry>): GitBranchEntry {
  return {
    name: "",
    kind: "local",
    worktreePath: null,
    isHead: false,
    isDetached: false,
    ahead: 0,
    behind: 0,
    upstream: null,
    upstreamGone: false,
    ...p,
  };
}

describe("taskBranchState", () => {
  const serial = "YOEZ-402";
  const b = "worktree_YOEZ-402";

  it("finds the worktree for the task branch", () => {
    const list = [
      entry({ name: "develop", isHead: true }),
      entry({
        name: b,
        kind: "worktree",
        worktreePath: "/r/.worktree/worktree_YOEZ-402/",
      }),
    ];
    expect(taskBranchState(list, serial)).toEqual({
      kind: "worktree",
      path: "/r/.worktree/worktree_YOEZ-402",
      branch: b,
    });
  });

  it("recognises a titled branch even after the title changed", () => {
    const titled = "worktree_YOEZ-402_米面柜初始化引导";
    const list = [
      entry({
        name: titled,
        kind: "worktree",
        worktreePath: `/r/.worktree/${titled}`,
      }),
    ];
    expect(taskBranchState(list, serial)).toEqual({
      kind: "worktree",
      path: `/r/.worktree/${titled}`,
      branch: titled,
    });
  });

  it("reports a branch that exists without a worktree", () => {
    expect(taskBranchState([entry({ name: b })], serial)).toEqual({
      kind: "branch",
      isHead: false,
      branch: b,
    });
  });

  it("ignores remote and look-alike branches", () => {
    const list = [
      entry({ name: `origin/${b}`, kind: "remote" }),
      entry({
        name: `${b}-2`,
        kind: "worktree",
        worktreePath: "/r/.worktree/worktree_YOEZ-402-2",
      }),
      entry({ name: "worktree_YOEZ-4021_别的任务" }),
    ];
    expect(taskBranchState(list, serial)).toEqual({ kind: "none" });
  });
});

describe("taskWorktreeBranch with title", () => {
  it("appends a cleaned title, at most 20 chars", () => {
    expect(
      taskWorktreeBranch("YOEZ-402", "【部队产品】米面柜-【初始化引导】"),
    ).toBe("worktree_YOEZ-402_部队产品米面柜-初始化引导");
    expect(
      taskWorktreeBranch(
        "YOEZ-1",
        "整理设备流量 使用情况/及:优化*方案?第一周把常用设备整理出来",
      ),
    ).toBe("worktree_YOEZ-1_整理设备流量_使用情况_及_优化_方案");
  });

  it("drops the title on Windows (ascii) or when it is empty", () => {
    expect(taskWorktreeBranch("YOEZ-402", "米面柜", true)).toBe(
      "worktree_YOEZ-402",
    );
    expect(taskWorktreeBranch("YOEZ-402", "【】")).toBe("worktree_YOEZ-402");
  });
});
