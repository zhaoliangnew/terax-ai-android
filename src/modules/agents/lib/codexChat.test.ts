import { describe, expect, it } from "vitest";
import { CodexChatModel, unwrapShell } from "./codexChat";

const msg = (id: string, text: string) => ({
  item: { type: "agentMessage", id, text },
});

describe("unwrapShell", () => {
  it("strips the login-shell wrapper", () => {
    expect(unwrapShell("/bin/zsh -lc 'printf hi > a.txt'")).toBe(
      "printf hi > a.txt",
    );
    expect(unwrapShell(`/bin/bash -lc 'echo '\\''x'\\'''`)).toBe("echo 'x'");
    expect(unwrapShell("ls -la")).toBe("ls -la");
  });
});

describe("CodexChatModel", () => {
  it("tracks manual compaction until its turn ends and releases queued input", async () => {
    const m = new CodexChatModel();
    m.beginCompaction(true, 1000);
    expect(m.compaction).toEqual({ startedAt: 1000, phase: "preparing" });
    expect(m.working).toBe(true);
    let released = false;
    const waiting = m.waitForCompaction().then(() => {
      released = true;
    });
    m.notify("turn/started", { turn: { id: "compact" } }, 1100);
    m.notify(
      "item/started",
      { item: { type: "contextCompaction", id: "c" } },
      1200,
    );
    expect(m.compaction?.phase).toBe("compacting");
    m.addUser("压缩期间发送的消息", [], 1300);
    m.notify(
      "item/completed",
      { item: { type: "contextCompaction", id: "c" } },
      5000,
    );
    expect(m.compaction?.phase).toBe("finishing");
    await Promise.resolve();
    expect(released).toBe(false);
    m.notify(
      "turn/completed",
      { turn: { id: "compact", status: "completed" } },
      6000,
    );
    await waiting;
    expect(m.compaction).toBeNull();
    expect(m.working).toBe(false);
    expect(m.items.find((it) => it.kind === "user")).not.toHaveProperty(
      "durationMs",
    );
    expect(m.items[m.items.length - 1]).toMatchObject({
      kind: "note",
      text: "上下文压缩完成,用时 5秒",
    });
  });

  it("tracks automatic compaction without ending the running user turn", async () => {
    const m = new CodexChatModel();
    m.addUser("继续");
    m.notify("turn/started", { turn: { id: "normal" } });
    m.notify(
      "item/started",
      { item: { type: "contextCompaction", id: "c" } },
      1000,
    );
    const waiting = m.waitForCompaction();
    m.notify(
      "item/completed",
      { item: { type: "contextCompaction", id: "c" } },
      2000,
    );
    await waiting;
    expect(m.compaction).toBeNull();
    expect(m.working).toBe(true);
    expect(m.turnId).toBe("normal");
  });

  it("rejects queued sends when compaction fails or is interrupted", async () => {
    for (const status of ["failed", "interrupted"]) {
      const m = new CodexChatModel();
      m.beginCompaction(true, 1000);
      m.notify("turn/started", { turn: { id: "compact" } });
      const waiting = m.waitForCompaction();
      const rejected = expect(waiting).rejects.toThrow();
      m.notify(
        "turn/completed",
        {
          turn: {
            id: "compact",
            status,
            error: { message: "network failure" },
          },
        },
        3000,
      );
      await rejected;
      expect(m.compaction).toBeNull();
      expect(m.working).toBe(false);
      expect(
        m.items.some(
          (it) => it.kind === "note" && it.text.startsWith("压缩未完成:"),
        ),
      ).toBe(true);
    }
  });

  it("keeps the start time across repeated lifecycle events and ignores other turns", () => {
    const m = new CodexChatModel();
    m.beginCompaction(true, 1000);
    m.beginCompaction(true, 2000);
    m.notify("turn/started", { turn: { id: "compact" } });
    expect(
      m.notify("turn/completed", { turn: { id: "old", status: "completed" } }),
    ).toBe(false);
    expect(m.compaction?.startedAt).toBe(1000);
    expect(m.working).toBe(true);
  });

  it("releases all waiters on request or process failure", async () => {
    const m = new CodexChatModel();
    m.beginCompaction(true);
    const waiters = [m.waitForCompaction(), m.waitForCompaction()];
    const rejected = waiters.map((waiting) =>
      expect(waiting).rejects.toThrow("进程已退出"),
    );
    m.finishCompaction("进程已退出");
    await Promise.all(rejected);
    expect(m.compaction).toBeNull();
  });

  it("streams a reply and settles it on completion", () => {
    const m = new CodexChatModel();
    m.addUser("hi");
    m.notify("turn/started", { turn: { id: "t1" } });
    expect(m.turnId).toBe("t1");
    m.notify("item/started", {
      item: {
        type: "userMessage",
        id: "u",
        content: [{ type: "text", text: "hi" }],
      },
    });
    m.notify("item/started", msg("a", ""));
    m.notify("item/agentMessage/delta", { itemId: "a", delta: "你" });
    m.notify("item/agentMessage/delta", { itemId: "a", delta: "好" });
    expect(m.items).toHaveLength(2);
    expect(m.items[1]).toMatchObject({
      kind: "assistant",
      text: "你好",
      streaming: true,
    });
    m.notify("item/completed", msg("a", "你好!"));
    expect(m.items[1]).toMatchObject({ text: "你好!" });
    expect(m.items[1]).not.toHaveProperty("streaming");
    m.notify("turn/completed", { turn: { id: "t1", status: "completed" } });
    expect(m.working).toBe(false);
    expect(m.turnId).toBeNull();
  });

  it("turns commands and file changes into tool cards", () => {
    const m = new CodexChatModel();
    m.notify("item/started", {
      item: {
        type: "commandExecution",
        id: "c",
        command: "/bin/zsh -lc 'ls'",
        status: "inProgress",
      },
    });
    expect(m.items[0]).toMatchObject({
      kind: "tool",
      name: "Bash",
      summary: "ls",
      result: null,
    });
    m.notify("item/completed", {
      item: {
        type: "commandExecution",
        id: "c",
        command: "/bin/zsh -lc 'ls'",
        status: "completed",
        aggregatedOutput: "a.txt\n",
        exitCode: 0,
      },
    });
    expect(m.items[0]).toMatchObject({
      result: { text: "a.txt", isError: false },
    });
    m.notify("item/completed", {
      item: {
        type: "fileChange",
        id: "f",
        status: "declined",
        changes: [{ path: "/w/src/a.ts", diff: "-x\n+y" }],
      },
    });
    expect(m.items[1]).toMatchObject({
      name: "Edit",
      summary: "a.ts",
      result: { isError: true },
    });
  });

  it("notes failures and interruptions", () => {
    const m = new CodexChatModel();
    m.notify("item/started", msg("a", "半"));
    m.notify("turn/completed", { turn: { status: "interrupted" } });
    expect(m.items[0]).toMatchObject({ streaming: false });
    expect(m.items[1]).toMatchObject({ kind: "note", text: "已中断" });
    expect(
      m.notify("error", { willRetry: true, error: { message: "x" } }),
    ).toBe(false);
  });

  it("loads history including the user's own messages", () => {
    const m = new CodexChatModel();
    m.loadHistory([
      {
        startedAt: 10,
        items: [
          {
            type: "userMessage",
            id: "u",
            content: [{ type: "text", text: "问" }],
          },
          { type: "reasoning", id: "r" },
          { type: "agentMessage", id: "a", text: "答" },
        ],
      },
    ]);
    expect(m.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(m.items[0].ts).toBe(10_000);
  });
});
