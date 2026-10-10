import type { GitBranchEntry } from "@/modules/ai/lib/native";
import type {
  Workitem,
  WorkitemDetail,
} from "@/modules/android-run/lib/codeupApi";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 假的磁盘和 git:哪些路径存在、git 根在哪、有哪些分支、调过哪些命令。 */
const fake = vi.hoisted(() => ({
  existing: new Set<string>(),
  top: null as string | null,
  head: "master" as string,
  branches: [] as GitBranchEntry[],
  calls: [] as string[],
  details: {} as Record<string, unknown>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { path: string }) =>
    cmd === "fs_stat" && fake.existing.has(args.path)
      ? Promise.resolve({})
      : Promise.reject(new Error("not found")),
}));

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    workspaceAuthorize: async () => {},
    gitResolveRepo: async () =>
      fake.top
        ? {
            repoRoot: fake.top,
            branch: fake.head,
            upstream: null,
            isDetached: false,
          }
        : null,
    gitListBranches: async (root: string) => {
      fake.calls.push(`list ${root}`);
      return { branches: fake.branches };
    },
    gitWorktreeAdd: async (root: string, base: string, branch: string) => {
      fake.calls.push(`add ${root} ${base} ${branch}`);
      const p = `${root}/.worktree/${branch}`;
      fake.existing.add(p);
      return p;
    },
    gitWorktreeAttach: async (root: string, branch: string) => {
      fake.calls.push(`attach ${root} ${branch}`);
      const p = `${root}/.worktree/${branch}`;
      fake.existing.add(p);
      return p;
    },
    readFile: async () => ({ kind: "text", content: "sdk.dir=/sdk" }),
    writeFile: async (p: string) => {
      fake.calls.push(`write ${p}`);
    },
    readDir: async () => [],
  },
}));

vi.mock("@/modules/android-run/BranchChip", () => ({
  GIT_BRANCH_CHANGED_EVENT: "git-branch-changed",
}));
vi.mock("@/modules/android-run/lib/adb", () => ({
  classifyProjectKind: async () => null,
}));
vi.mock("@/modules/android-run/lib/yunxiao", () => ({
  getProjectLink: () => null,
  listProjectLinkDirs: () => [],
}));
vi.mock("@/modules/android-run/store", () => ({
  useAndroidRunStore: { getState: () => ({ projectRoot: null }) },
}));
vi.mock("@/modules/workspace", () => ({ currentWorkspaceEnv: () => null }));
vi.mock("@/modules/android-run/lib/codeupApi", () => ({
  getWorkitem: async (_org: string, _token: string, id: string) => {
    fake.calls.push(`getWorkitem ${id}`);
    const d = fake.details[id];
    if (!d) throw new Error("404");
    return d;
  },
  workitemUrl: (p: string, id: string) => `https://projex/${p}/${id}`,
}));

vi.stubGlobal("window", { dispatchEvent: () => true });

const { ensureTaskWorktree, prepareWorkitemLaunch, probeTaskWorktree } =
  await import("./workitemLaunch");

function branch(over: Partial<GitBranchEntry>): GitBranchEntry {
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
    ...over,
  };
}

beforeEach(() => {
  fake.existing.clear();
  fake.top = "/w/app_cheng";
  fake.head = "master";
  fake.branches = [];
  fake.calls.length = 0;
  fake.details = {};
});

describe("ensureTaskWorktree", () => {
  it("没有任务分支:基于当前分支新建", async () => {
    const r = await ensureTaskWorktree("/w/app_cheng", "YOEZ-402");
    expect(r).toEqual({
      path: "/w/app_cheng/.worktree/worktree_YOEZ-402",
      created: true,
    });
    expect(fake.calls).toContain("add /w/app_cheng master worktree_YOEZ-402");
  });

  it("worktree 删了、分支还在:挂回去,不新建也不报错叫人删分支", async () => {
    fake.branches = [branch({ name: "worktree_YOEZ-402" })];
    const r = await ensureTaskWorktree("/w/app_cheng", "YOEZ-402");
    expect(r.path).toBe("/w/app_cheng/.worktree/worktree_YOEZ-402");
    expect(fake.calls).toContain("attach /w/app_cheng worktree_YOEZ-402");
    expect(fake.calls.some((c) => c.startsWith("add "))).toBe(false);
  });

  it("记录还在但目录没了:也走挂回(Rust 侧先 prune)", async () => {
    fake.branches = [
      branch({
        name: "worktree_YOEZ-402",
        kind: "worktree",
        worktreePath: "/w/app_cheng/.worktree/worktree_YOEZ-402",
      }),
    ];
    await ensureTaskWorktree("/w/app_cheng", "YOEZ-402");
    expect(fake.calls).toContain("attach /w/app_cheng worktree_YOEZ-402");
  });

  it("已经挂着、目录也在:直接复用", async () => {
    const p = "/w/app_cheng/.worktree/worktree_YOEZ-402";
    fake.existing.add(p);
    fake.branches = [
      branch({ name: "worktree_YOEZ-402", kind: "worktree", worktreePath: p }),
    ];
    expect(await ensureTaskWorktree("/w/app_cheng", "YOEZ-402")).toEqual({
      path: p,
      created: false,
    });
    expect(
      fake.calls.some((c) => c.startsWith("add ") || c.startsWith("attach ")),
    ).toBe(false);
  });

  it("不是 git 仓库:直接说清楚,不去调 git worktree add", async () => {
    fake.top = null;
    await expect(ensureTaskWorktree("/w/plain", "YOEZ-402")).rejects.toThrow(
      /不是 git 仓库/,
    );
    expect(fake.calls).toEqual([]);
  });

  it("工程在大仓库子目录里:从 git 根建,开发目录和 local.properties 落到子目录", async () => {
    fake.top = "/w/mono";
    fake.existing.add("/w/mono/.worktree/worktree_YOEZ-402/android");
    // 子目录在新 worktree 里也会有(它在 git 里)
    const r = await ensureTaskWorktree("/w/mono/android", "YOEZ-402");
    expect(fake.calls).toContain("add /w/mono master worktree_YOEZ-402");
    expect(r.path).toBe("/w/mono/.worktree/worktree_YOEZ-402/android");
    expect(fake.calls).toContain(
      "write /w/mono/.worktree/worktree_YOEZ-402/android/local.properties",
    );
  });
});

describe("probeTaskWorktree", () => {
  it("分别认出 none / branch / missing / head / 非 git", async () => {
    expect(await probeTaskWorktree("/w/app_cheng", "YOEZ-402")).toMatchObject({
      isRepo: true,
      state: "none",
      branch: "master",
      devDir: "/w/app_cheng/.worktree/worktree_YOEZ-402",
    });

    fake.branches = [branch({ name: "worktree_YOEZ-402" })];
    expect((await probeTaskWorktree("/w/app_cheng", "YOEZ-402")).state).toBe(
      "branch",
    );

    fake.branches = [branch({ name: "worktree_YOEZ-402", isHead: true })];
    expect(await probeTaskWorktree("/w/app_cheng", "YOEZ-402")).toMatchObject({
      state: "head",
      devDir: null,
    });

    fake.branches = [
      branch({
        name: "worktree_YOEZ-402",
        kind: "worktree",
        worktreePath: "/w/app_cheng/.worktree/worktree_YOEZ-402",
      }),
    ];
    expect((await probeTaskWorktree("/w/app_cheng", "YOEZ-402")).state).toBe(
      "missing",
    );

    fake.top = null;
    expect(await probeTaskWorktree("/w/plain", "YOEZ-402")).toMatchObject({
      isRepo: false,
      devDir: null,
    });
  });
});

function detail(over: Partial<WorkitemDetail>): WorkitemDetail {
  return {
    id: "t1",
    subject: "去皮按钮",
    serialNumber: "YOEZ-433",
    statusName: "",
    statusId: "",
    assignedTo: "",
    assignedToId: "",
    creator: "",
    creatorId: "",
    gmtCreate: "",
    startDate: "",
    startDateFieldId: "",
    dueDate: "",
    dueDateFieldId: "",
    estimatedHours: "",
    estimatedHoursFieldId: "",
    actualHours: "",
    actualHoursFieldId: "",
    description: "",
    formatType: "RICHTEXT",
    parentId: "",
    workitemTypeId: "",
    workitemTypeName: "",
    categoryId: "Task",
    spaceId: "p1",
    spaceName: "设备端",
    ...over,
  };
}

describe("prepareWorkitemLaunch", () => {
  it("任务正文只有截图:照样去拉父需求,把父需求的描述带上", async () => {
    fake.details = {
      t1: detail({
        description: '<article><p><img src="shot.png"></p></article>',
        parentId: "r1",
      }),
      r1: detail({
        id: "r1",
        serialNumber: "YOEZ-402",
        subject: "称重页改版",
        categoryId: "Req",
        description: "<article><p>称重页加去皮按钮</p></article>",
      }),
    };
    const r = await prepareWorkitemLaunch({
      orgId: "o",
      token: "t",
      item: fake.details.t1 as Workitem,
      project: { id: "p1", name: "设备端" },
      devDir: "/w/app_cheng",
      worktree: false,
      agent: "claude",
    });
    expect(fake.calls).toContain("getWorkitem r1");
    expect(r.prompt).toContain("称重页加去皮按钮");
    expect(r.prompt).toContain("的描述只有 1 张图片、没有文字");
    expect(r.degraded).toBe(false);
  });
});
