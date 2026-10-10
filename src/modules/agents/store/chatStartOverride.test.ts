import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 从任务开的会话:权限模式只给这个窗格用(启动参数里要是它),不能写进
 * localStorage 变成以后的默认;启动失败重试走 restart,排队的旧消息不能补发。
 */

type Call = { cmd: string; args: Record<string, unknown> };
const tauri = vi.hoisted(() => ({
  calls: [] as Call[],
  /** 下一次 *_chat_start 的结果:数字 = chatId,字符串 = 报错。 */
  starts: [] as (number | string)[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((line: string) => void) | null = null;
  },
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    tauri.calls.push({ cmd, args });
    if (cmd.endsWith("_chat_start")) {
      const next = tauri.starts.shift() ?? 1;
      return typeof next === "number"
        ? Promise.resolve(next)
        : Promise.reject(new Error(next));
    }
    return Promise.resolve();
  },
}));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));

const claude = await import("./claudeChatStore");
const codex = await import("./codexChatStore");

const flush = () => new Promise((r) => setTimeout(r, 0));
const startArgs = (cmd: string) =>
  tauri.calls.filter((c) => c.cmd === cmd).map((c) => c.args);
const sentOps = () =>
  tauri.calls
    .filter((c) => c.cmd === "claude_chat_send")
    .map(
      (c) => JSON.parse(String(c.args.line)) as { op: string; text?: string },
    );

beforeEach(() => {
  tauri.calls.length = 0;
  tauri.starts.length = 0;
  store.clear();
});

describe("Claude 会话的权限覆盖", () => {
  it("启动参数用覆盖的模式,不写进 localStorage,也不接上次的会话", async () => {
    store.set("terax.chat.permissionMode", "bypassPermissions");
    store.set("terax.chat.lastSession:/repo", "old-session");
    claude.ensureChat(101, "/repo", true, "default");
    const [args] = startArgs("claude_chat_start");
    expect(args.permissionMode).toBe("default");
    expect(args.resume).toBeNull();
    expect(
      claude.useClaudeChatStore.getState().sessions[101]?.permissionMode,
    ).toBe("default");
    expect(store.get("terax.chat.permissionMode")).toBe("bypassPermissions");
  });

  it("同一个窗格之后再起会话也沿用;别的窗格还是平时的默认", () => {
    store.set("terax.chat.permissionMode", "bypassPermissions");
    claude.ensureChat(102, "/repo", true, "default");
    claude.restartChat(102, "/repo");
    claude.ensureChat(103, "/repo", true);
    const modes = startArgs("claude_chat_start").map((a) => a.permissionMode);
    expect(modes).toEqual(["default", "default", "bypassPermissions"]);
  });

  it("在聊天里手动改模式后覆盖作废", () => {
    claude.ensureChat(104, "/repo", true, "default");
    claude.setChatMode(104, "acceptEdits");
    claude.restartChat(104, "/repo");
    const modes = startArgs("claude_chat_start").map((a) => a.permissionMode);
    expect(modes).toEqual(["default", "acceptEdits"]);
  });

  it("不认识的模式不当回事", () => {
    store.set("terax.chat.permissionMode", "plan");
    claude.ensureChat(105, "/repo", true, "whatever");
    expect(startArgs("claude_chat_start")[0].permissionMode).toBe("plan");
  });

  it("启动失败后 restart + send 只发一次", async () => {
    tauri.starts.push("cwd is outside the authorized workspace", 7);
    claude.ensureChat(106, "/repo", true, "default");
    claude.sendChat(106, "开工");
    await flush();
    expect(claude.useClaudeChatStore.getState().sessions[106]?.status).toBe(
      "error",
    );
    claude.restartChat(106, "/repo", { permissionMode: "default" });
    claude.sendChat(106, "开工");
    await flush();
    expect(sentOps().filter((o) => o.op === "send")).toEqual([
      { op: "send", text: "开工", attachments: [] },
    ]);
    expect(startArgs("claude_chat_start").map((a) => a.permissionMode)).toEqual(
      ["default", "default"],
    );
  });
});

describe("任务会话换了窗格、重启后接着聊", () => {
  /** 往某次启动的事件通道里塞一行(假装桥接进程报上来的)。 */
  const emit = (startIndex: number, evt: unknown) => {
    const ch = startArgs("claude_chat_start")[startIndex].onEvent as {
      onmessage: (line: string) => void;
    };
    ch.onmessage(JSON.stringify(evt));
  };

  it("Claude:新窗格接上任务会话时沿用「先问」,不回到完全访问", async () => {
    store.set("terax.chat.permissionMode", "bypassPermissions");
    claude.ensureChat(301, "/wt", true, "default");
    await flush();
    emit(0, {
      type: "sdk",
      msg: { type: "system", subtype: "init", session_id: "task-1" },
    });
    emit(0, { type: "sdk", msg: { type: "result", session_id: "task-1" } });
    expect(store.get("terax.chat.lastSession:/wt")).toBe("task-1");

    // tab 关了 / 重启后恢复:另一个窗格不带任何覆盖接着这个目录聊
    claude.ensureChat(302, "/wt");
    const args = startArgs("claude_chat_start")[1];
    expect(args.resume).toBe("task-1");
    expect(args.permissionMode).toBe("default");
    // 别的会话不受影响
    claude.ensureChat(303, "/elsewhere");
    expect(startArgs("claude_chat_start")[2].permissionMode).toBe(
      "bypassPermissions",
    );
  });

  it("Claude:在聊天里手动改了模式,接着聊就按手动的", async () => {
    store.set("terax.chat.permissionMode", "bypassPermissions");
    claude.ensureChat(311, "/wt2", true, "default");
    await flush();
    emit(0, {
      type: "sdk",
      msg: { type: "system", subtype: "init", session_id: "task-2" },
    });
    claude.setChatMode(311, "acceptEdits");
    store.set("terax.chat.lastSession:/wt2", "task-2");
    claude.ensureChat(312, "/wt2");
    expect(startArgs("claude_chat_start")[1].permissionMode).toBe(
      "acceptEdits",
    );
  });

  it("Claude:启动失败后在输入框里发消息,不会把排队的旧需求补发出去", async () => {
    tauri.starts.push("没找到 Qoder 命令行", 9);
    claude.ensureChat(321, "/repo", true, "default");
    claude.sendChat(321, "旧需求");
    await flush();
    expect(claude.useClaudeChatStore.getState().sessions[321]?.status).toBe(
      "error",
    );
    claude.ensureChat(321, "/repo");
    claude.sendChat(321, "新的一句");
    await flush();
    expect(sentOps().filter((o) => o.op === "send")).toEqual([
      { op: "send", text: "新的一句", attachments: [] },
    ]);
  });

  it("Codex:接上带过覆盖的 thread 时沿用它的模式", () => {
    store.set("terax.codexChat.permissionMode", "full");
    store.set("terax.codexChat.lastThread:/wt", "th-1");
    store.set("terax.codexChat.threadMode:th-1", "readonly");
    codex.ensureCodexChat(331, "/wt");
    expect(
      codex.useCodexChatStore.getState().sessions[331]?.permissionMode,
    ).toBe("readonly");
    store.set("terax.codexChat.lastThread:/other", "th-2");
    codex.ensureCodexChat(332, "/other");
    expect(
      codex.useCodexChatStore.getState().sessions[332]?.permissionMode,
    ).toBe("full");
  });
});

describe("Codex 会话的权限覆盖", () => {
  it("用覆盖的模式,不写进 localStorage", () => {
    store.set("terax.codexChat.permissionMode", "full");
    codex.ensureCodexChat(201, "/repo", true, "readonly");
    expect(
      codex.useCodexChatStore.getState().sessions[201]?.permissionMode,
    ).toBe("readonly");
    expect(store.get("terax.codexChat.permissionMode")).toBe("full");
  });

  it("restart 沿用;手动改了就作废", () => {
    codex.ensureCodexChat(202, "/repo", true, "readonly");
    codex.restartCodex(202, "/repo");
    expect(
      codex.useCodexChatStore.getState().sessions[202]?.permissionMode,
    ).toBe("readonly");
    codex.setCodexMode(202, "auto");
    codex.restartCodex(202, "/repo");
    expect(
      codex.useCodexChatStore.getState().sessions[202]?.permissionMode,
    ).toBe("auto");
  });
});
