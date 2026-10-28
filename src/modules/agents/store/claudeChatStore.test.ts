import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  channels: [] as { onmessage?: (line: string) => void }[],
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    constructor() {
      transport.channels.push(this);
    }
  },
  invoke: transport.invoke,
}));

beforeEach(() => {
  vi.resetModules();
  transport.channels = [];
  transport.invoke.mockReset().mockResolvedValue(42);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
const emit = (event: unknown, channel = 0) =>
  transport.channels[channel].onmessage?.(JSON.stringify(event));
const starts = () =>
  transport.invoke.mock.calls.filter(([cmd]) => cmd === "claude_chat_start");

describe("Claude 仅在手动恢复时建立连接", () => {
  it("加载聊天 store 和读取历史会话 id 不会启动进程", async () => {
    localStorage.setItem("terax.chat.lastSession:/repo", "old-session");
    const { useClaudeChatStore } = await import(
      "@/modules/agents/store/claudeChatStore"
    );
    expect(useClaudeChatStore.getState().sessions).toEqual({});
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it.each(["No conversation found", "Error resuming session"])(
    "%s 后不会自动创建新会话或重发消息",
    async (message) => {
      localStorage.setItem("terax.chat.lastSession:/repo", "old-session");
      const { ensureChat, sendChat, useClaudeChatStore } = await import(
        "@/modules/agents/store/claudeChatStore"
      );
      ensureChat(7, "/repo");
      sendChat(7, "旧的待发送消息");
      await Promise.resolve();
      emit({ type: "error", message });
      emit({ type: "closed" });
      expect(starts()).toHaveLength(1);
      expect(useClaudeChatStore.getState().sessions[7]).toMatchObject({
        status: "error",
        chatId: null,
      });
      expect(localStorage.getItem("terax.chat.lastSession:/repo")).toBeNull();

      transport.invoke.mockClear();
      ensureChat(7, "/repo");
      await Promise.resolve();
      expect(starts()).toHaveLength(1);
      expect(starts()[0][1]).toMatchObject({ resume: null });
      expect(
        transport.invoke.mock.calls.some(([cmd]) => cmd === "claude_chat_send"),
      ).toBe(false);
    },
  );

  it("网络错误和退出后不会自动重连,也不会向已结束进程请求模型", async () => {
    const { ensureChat, requestModels, useClaudeChatStore } = await import(
      "@/modules/agents/store/claudeChatStore"
    );
    ensureChat(7, "/repo");
    await Promise.resolve();
    emit({ type: "error", message: "proxy connection refused" });
    emit({ type: "closed" });
    requestModels(7);
    expect(starts()).toHaveLength(1);
    expect(useClaudeChatStore.getState().sessions[7].status).toBe("closed");
    expect(
      transport.invoke.mock.calls.some(([cmd]) => cmd === "claude_chat_send"),
    ).toBe(false);
  });

  it("退出事件先于启动回执时,不补发排队消息也不重新标记为已连接", async () => {
    let complete!: (id: number) => void;
    transport.invoke.mockImplementation((cmd) =>
      cmd === "claude_chat_start"
        ? new Promise<number>((resolve) => {
            complete = resolve;
          })
        : Promise.resolve(),
    );
    const { ensureChat, sendChat, useClaudeChatStore } = await import(
      "@/modules/agents/store/claudeChatStore"
    );
    ensureChat(7, "/repo");
    sendChat(7, "不能补发的消息");
    emit({ type: "closed" });
    complete(42);
    await Promise.resolve();
    expect(useClaudeChatStore.getState().sessions[7]).toMatchObject({
      status: "closed",
      chatId: null,
    });
    expect(transport.invoke).toHaveBeenCalledWith("claude_chat_stop", {
      id: 42,
    });
    expect(
      transport.invoke.mock.calls.some(([cmd]) => cmd === "claude_chat_send"),
    ).toBe(false);
  });

  it("连续点击恢复只启动一个进程", async () => {
    const { ensureChat } = await import(
      "@/modules/agents/store/claudeChatStore"
    );
    ensureChat(7, "/repo");
    ensureChat(7, "/repo");
    expect(starts()).toHaveLength(1);
  });

  it("旧进程迟到的关闭事件不能触发重连或关闭手动恢复的新会话", async () => {
    const { ensureChat, useClaudeChatStore } = await import(
      "@/modules/agents/store/claudeChatStore"
    );
    ensureChat(7, "/repo");
    await Promise.resolve();
    emit({ type: "closed" });
    ensureChat(7, "/repo");
    emit({ type: "error", message: "No conversation found" }, 0);
    emit({ type: "closed" }, 0);
    expect(starts()).toHaveLength(2);
    expect(useClaudeChatStore.getState().sessions[7].status).toBe("starting");
  });
});
