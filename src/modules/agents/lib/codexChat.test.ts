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
