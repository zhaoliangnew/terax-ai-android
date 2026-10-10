import type { Tab } from "@/modules/tabs/lib/useTabs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
/** 假的聊天会话:窗格 id → 状态。 */
const sessions = vi.hoisted(
  () => new Map<number, { status: string; sessionId: string | null }>(),
);
const saved = vi.hoisted(() => new Map<string, string>());
vi.stubGlobal("localStorage", {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
  removeItem: (k: string) => void saved.delete(k),
});

vi.mock("../store/chatProviders", () => {
  const api = (agent: string) => ({
    ensure: (leafId: number, cwd: string, opts?: unknown) =>
      calls.push(`${agent}.ensure ${leafId} ${cwd} ${JSON.stringify(opts)}`),
    restart: (leafId: number, cwd: string, opts?: unknown) =>
      calls.push(`${agent}.restart ${leafId} ${cwd} ${JSON.stringify(opts)}`),
    send: (leafId: number, text: string) =>
      calls.push(`${agent}.send ${leafId} ${text}`),
  });
  return {
    CHAT_APIS: {
      claude: api("claude"),
      codex: api("codex"),
      qoder: api("qoder"),
    },
    chatSessionNow: (_agent: string, leafId: number) => sessions.get(leafId),
  };
});

vi.mock("../store/agentViewStore", () => ({
  useAgentViewStore: {
    getState: () => ({
      setAgent: (leafId: number, agent: string) =>
        calls.push(`setAgent ${leafId} ${agent}`),
      setMode: (leafId: number, mode: string) =>
        calls.push(`setMode ${leafId} ${mode}`),
    }),
  },
}));

vi.mock("./chatPrefs", () => ({
  saveAgent: (dir: string, agent: string) =>
    calls.push(`saveAgent ${dir} ${agent}`),
  saveView: (dir: string, view: string) =>
    calls.push(`saveView ${dir} ${view}`),
}));

const {
  bindChatTaskHost,
  focusChatTask,
  isChatTaskOpen,
  launchChatInLeaf,
  otherTaskOnDir,
  rememberChatTask,
  reopenChatTask,
  retryChatTask,
  taskTabState,
} = await import("./startChatTask");

function termTab(id: number, leafIds: number[]): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "s",
    title: "t",
    activeLeafId: leafIds[0],
    paneTree:
      leafIds.length === 1
        ? { kind: "leaf", id: leafIds[0] }
        : {
            kind: "split",
            id: 999,
            dir: "row",
            children: leafIds.map((l) => ({ kind: "leaf" as const, id: l })),
          },
  };
}

const entry = (over: Partial<Parameters<typeof taskTabState>[0]> = {}) => ({
  tabId: 1,
  leafId: 2,
  dir: "/repo",
  title: "YOEZ-1 标题",
  at: 1000,
  seen: false,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  sessions.clear();
});

describe("launchChatInLeaf", () => {
  it("按顺序:选 AI → 记目录 → 全新会话(带权限覆盖)→ 切聊天 → 发消息", () => {
    launchChatInLeaf(7, "/repo/.worktree/worktree_YOEZ-1", "claude", "开工");
    expect(calls).toEqual([
      "setAgent 7 claude",
      "saveAgent /repo/.worktree/worktree_YOEZ-1 claude",
      'claude.ensure 7 /repo/.worktree/worktree_YOEZ-1 {"fresh":true,"permissionMode":"default"}',
      "setMode 7 chat",
      "saveView /repo/.worktree/worktree_YOEZ-1 chat",
      "claude.send 7 开工",
    ]);
  });

  it("Codex 用只读,Qoder 用 default", () => {
    launchChatInLeaf(3, "/r", "codex", "x");
    launchChatInLeaf(4, "/r", "qoder", "y");
    expect(calls).toContain(
      'codex.ensure 3 /r {"fresh":true,"permissionMode":"readonly"}',
    );
    expect(calls).toContain(
      'qoder.ensure 4 /r {"fresh":true,"permissionMode":"default"}',
    );
  });
});

describe("retryChatTask", () => {
  it("走 restart 再发,不走 ensure(否则排队的旧消息会重复发)", () => {
    retryChatTask(7, "/repo", "claude", "开工");
    expect(calls.some((c) => c.includes(".ensure"))).toBe(false);
    const restart = calls.findIndex((c) =>
      c.startsWith('claude.restart 7 /repo {"permissionMode":"default"}'),
    );
    const send = calls.indexOf("claude.send 7 开工");
    expect(restart).toBeGreaterThanOrEqual(0);
    expect(send).toBeGreaterThan(restart);
  });
});

describe("taskTabState", () => {
  it("tab 和窗格都在:open,并记下见过", () => {
    const e = entry();
    expect(taskTabState(e, [termTab(1, [2])], 1000)).toBe("open");
    expect(e.seen).toBe(true);
  });

  it("分屏里的窗格也算", () => {
    expect(taskTabState(entry(), [termTab(1, [5, 2])], 1000)).toBe("open");
  });

  it("刚开、还没进 tab 列表:pending;过了宽限期就是 gone", () => {
    expect(taskTabState(entry(), [], 2000)).toBe("pending");
    expect(taskTabState(entry(), [], 1000 + 5000)).toBe("gone");
  });

  it("见过之后再找不到:gone(不再给宽限)", () => {
    expect(taskTabState(entry({ seen: true }), [], 1001)).toBe("gone");
  });

  it("tab 还在但窗格关了:gone", () => {
    expect(taskTabState(entry(), [termTab(1, [9])], 1000)).toBe("gone");
  });
});

describe("任务登记", () => {
  it("没挂 host 时一律当没开", () => {
    rememberChatTask("k0", entry({ tabId: 50, at: 0 }));
    expect(isChatTaskOpen("k0")).toBe(false);
  });

  it("开着就能切过去;tab 关了自动忘掉", () => {
    let tabs: Tab[] = [termTab(1, [2]), termTab(10, [11])];
    const focused: string[] = [];
    const unbind = bindChatTaskHost({
      tabs: () => tabs,
      focus: (t, l) => focused.push(`${t}/${l}`),
    });
    rememberChatTask("a", entry({ at: Date.now() }));
    rememberChatTask(
      "b",
      entry({ tabId: 10, leafId: 11, title: "B", at: Date.now() }),
    );

    expect(isChatTaskOpen("a")).toBe(true);
    expect(focusChatTask("a")).toBe(true);
    expect(focused).toEqual(["1/2"]);
    expect(otherTaskOnDir("/repo", "a")?.title).toBe("B");
    expect(otherTaskOnDir("/other", "a")).toBeNull();

    tabs = [termTab(10, [11])];
    expect(isChatTaskOpen("a")).toBe(false);
    expect(focusChatTask("a")).toBe(false);
    expect(otherTaskOnDir("/repo", "b")).toBeNull();

    unbind();
    expect(isChatTaskOpen("b")).toBe(false);
  });
});

describe("重启之后", () => {
  /** 重启后恢复出来的 tab:id 都变了,标题和目录还在。 */
  const restored = (id: number, leaf: number, title: string, cwd: string) =>
    ({
      ...termTab(id, [leaf]),
      customTitle: title,
      paneTree: { kind: "leaf", id: leaf, cwd },
    }) as Tab;

  it("按标题 + 目录认回恢复出来的任务 tab,不再开第二个", async () => {
    saved.clear();
    rememberChatTask(
      "w1",
      entry({ tabId: 70, leafId: 71, dir: "/wt", title: "YOEZ-9 去皮" }),
    );
    // 模拟重启:模块状态清空,localStorage 还在
    vi.resetModules();
    const fresh = await import("./startChatTask");
    let ready = false;
    const tabs: Tab[] = [
      restored(3, 4, "YOEZ-9 去皮", "/other"),
      restored(5, 6, "YOEZ-9 去皮", "/wt"),
    ];
    const focused: string[] = [];
    const unbind = fresh.bindChatTaskHost({
      tabs: () => (ready ? tabs : []),
      focus: (t, l) => focused.push(`${t}/${l}`),
      ready: () => ready,
    });
    // tab 还没恢复完:不算开着,也不能把登记删了
    expect(fresh.isChatTaskOpen("w1")).toBe(false);
    ready = true;
    expect(fresh.reopenChatTask("w1")).toBe("focused");
    expect(focused).toEqual(["5/6"]);
    expect(fresh.otherTaskOnDir("/wt", "zz")?.title).toBe("YOEZ-9 去皮");
    unbind();
  });

  it("恢复出来的 tab 里没有它:忘掉这条登记", async () => {
    saved.clear();
    rememberChatTask("w2", entry({ dir: "/wt2", title: "B" }));
    vi.resetModules();
    const fresh = await import("./startChatTask");
    const unbind = fresh.bindChatTaskHost({
      tabs: () => [],
      focus: () => {},
      ready: () => true,
    });
    expect(fresh.isChatTaskOpen("w2")).toBe(false);
    expect(saved.get("terax.chat.taskTabs.v1") ?? "").not.toContain("w2");
    unbind();
  });
});

describe("reopenChatTask", () => {
  it("会话当初没启动起来:切过去并重来;起来了就只切过去", () => {
    const tabs: Tab[] = [termTab(1, [2])];
    const retried: string[] = [];
    const unbind = bindChatTaskHost({
      tabs: () => tabs,
      focus: () => {},
      retry: (key, e) => retried.push(`${key} ${e.prompt}`),
    });
    rememberChatTask(
      "f1",
      entry({ at: Date.now(), agent: "claude", prompt: "开工" }),
    );
    sessions.set(2, { status: "error", sessionId: null });
    expect(reopenChatTask("f1")).toBe("retried");
    expect(retried).toEqual(["f1 开工"]);

    sessions.set(2, { status: "ready", sessionId: "s1" });
    expect(reopenChatTask("f1")).toBe("focused");
    // 起来过、后来退出的不算启动失败
    sessions.set(2, { status: "closed", sessionId: "s1" });
    expect(reopenChatTask("f1")).toBe("focused");
    expect(retried).toHaveLength(1);
    expect(reopenChatTask("nope")).toBeNull();
    unbind();
  });
});
