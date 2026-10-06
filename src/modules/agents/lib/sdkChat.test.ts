import { describe, expect, it } from "vitest";
import { SdkChatModel, type SdkMessage } from "./sdkChat";

const se = (event: SdkMessage["event"]): SdkMessage => ({
  type: "stream_event",
  event,
  parent_tool_use_id: null,
});
const assistant = (id: string, content: unknown[]): SdkMessage => ({
  type: "assistant",
  message: { id, content: content as never },
  parent_tool_use_id: null,
});

describe("SdkChatModel", () => {
  it("tracks compaction and notes the new context size", () => {
    const m = new SdkChatModel();
    m.addUser("/compact");
    m.apply({ type: "system", subtype: "status", status: "compacting" });
    expect(m.compacting).toBe(true);
    m.apply({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { pre_tokens: 550_000, post_tokens: 12_000 },
    });
    expect(m.compacting).toBe(false);
    expect(m.context?.tokens).toBe(12_000);
    expect(m.items[m.items.length - 1]).toMatchObject({
      kind: "note",
      text: "上下文已压缩:550k → 12k tokens",
    });
    m.apply({ type: "result", subtype: "success" });
    expect(m.working).toBe(false);
  });

  it("keeps init command names until the detailed list arrives", () => {
    const m = new SdkChatModel();
    m.apply({
      type: "system",
      subtype: "init",
      slash_commands: ["pdf"],
      skills: ["pdf"],
    });
    expect(m.commands?.map((c) => c.name)).toEqual(["pdf"]);
    m.setCommands([{ name: "pdf", description: "PDF files" }]);
    m.apply({ type: "system", subtype: "init", slash_commands: [] });
    expect(m.commands?.[0].description).toBe("PDF files");
  });

  it("hides synthetic user messages when loading history", () => {
    const m = new SdkChatModel();
    m.loadHistory([
      { type: "user", isSynthetic: true, message: { content: "summary" } },
      { type: "user", message: { content: "hi" } },
    ]);
    expect(m.items.map((i) => i.kind === "user" && i.text)).toEqual(["hi"]);
  });

  it("reads session info from init", () => {
    const m = new SdkChatModel();
    m.apply({
      type: "system",
      subtype: "init",
      session_id: "s1",
      model: "claude-opus-5-5[1m]",
      permissionMode: "default",
    });
    expect([m.sessionId, m.model, m.permissionMode]).toEqual([
      "s1",
      "claude-opus-5-5[1m]",
      "default",
    ]);
  });

  it("streams text, then settles it with the full message (real SDK shape)", () => {
    const m = new SdkChatModel();
    m.addUser("hi");
    expect(m.working).toBe(true);
    m.apply(se({ type: "message_start", message: { id: "msg1" } }));
    m.apply(
      se({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking" },
      }),
    );
    m.apply(
      se({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta" },
      }),
    );
    m.apply(assistant("msg1", [{ type: "thinking", thinking: "" }]));
    m.apply(
      se({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "你" },
      }),
    );
    m.apply(
      se({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "好" },
      }),
    );
    expect(m.items[1]).toMatchObject({
      kind: "assistant",
      text: "你好",
      streaming: true,
    });
    // the full message carries only this block, at content index 0
    m.apply(assistant("msg1", [{ type: "text", text: "你好!" }]));
    expect(m.items).toHaveLength(2);
    expect(m.items[1]).toMatchObject({ text: "你好!", streaming: false });
    m.apply({ type: "result", subtype: "success", is_error: false });
    expect(m.working).toBe(false);
  });

  it("adds tool cards and fills in their results", () => {
    const m = new SdkChatModel();
    m.apply(
      assistant("msg2", [
        {
          type: "tool_use",
          id: "t1",
          name: "Bash",
          input: { command: "ls", description: "列文件" },
        },
      ]),
    );
    m.apply({
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "a.txt",
            is_error: false,
          },
        ] as never,
      },
    });
    expect(m.items).toEqual([
      expect.objectContaining({
        kind: "tool",
        summary: "列文件",
        result: { text: "a.txt", isError: false },
      }),
    ]);
  });

  it("tracks a background subagent on the card that launched it", () => {
    const m = new SdkChatModel();
    m.addUser("做引导页", [], 0);
    m.apply(
      assistant("msg5", [
        {
          type: "tool_use",
          id: "t1",
          name: "Agent",
          input: { description: "引导页", prompt: "做引导页" },
        },
      ]),
      1000,
    );
    m.apply(
      {
        type: "system",
        subtype: "task_started",
        task_id: "k1",
        tool_use_id: "t1",
        is_backgrounded: true,
      },
      1000,
    );
    m.apply({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "launched" },
        ],
      },
    });
    m.apply({ type: "result", subtype: "success" });
    m.apply({
      ...assistant("c1", [
        {
          type: "tool_use",
          id: "c-t",
          name: "Read",
          input: { file_path: "/p/Guide.kt" },
        },
      ]),
      parent_tool_use_id: "t1",
    });
    const card = () => m.items.find((i) => i.id === "t1");
    expect(card()).toMatchObject({
      task: {
        status: "running",
        background: true,
        toolUses: 1,
        activity: "Read Guide.kt",
      },
    });
    m.apply({
      type: "system",
      subtype: "task_notification",
      task_id: "k1",
      status: "completed",
      summary: "做完了",
      usage: { tool_uses: 7, duration_ms: 90_000 },
    });
    expect(card()).toMatchObject({
      task: { status: "completed", toolUses: 7, durationMs: 90_000 },
    });
  });

  it("finishes a foreground subagent when its result comes back", () => {
    const m = new SdkChatModel();
    m.apply(
      assistant("msg6", [
        { type: "tool_use", id: "t2", name: "Agent", input: {} },
      ]),
    );
    m.apply({
      ...assistant("c2", [
        { type: "tool_use", id: "c-b", name: "Bash", input: { command: "ls" } },
      ]),
      parent_tool_use_id: "t2",
    });
    m.apply({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t2", content: "ok" }],
      },
    });
    expect(m.items[0]).toMatchObject({
      task: { status: "completed", background: false, toolUses: 1 },
    });
  });

  it("keeps a message without streaming, and ignores subagent traffic", () => {
    const m = new SdkChatModel();
    m.apply(assistant("msg3", [{ type: "text", text: "直接到了" }]));
    m.apply({
      ...assistant("msg4", [{ type: "text", text: "子 agent 的话" }]),
      parent_tool_use_id: "t9",
    });
    expect(m.items.map((i) => ("text" in i ? i.text : ""))).toEqual([
      "直接到了",
    ]);
  });

  it("lays out a resumed session's earlier turns", () => {
    const m = new SdkChatModel();
    m.loadHistory([
      { type: "user", message: { content: "看下项目" } },
      {
        type: "user",
        message: { content: "<command-name>/model</command-name>" },
      },
      assistant("h1", [
        {
          type: "tool_use",
          id: "t1",
          name: "Read",
          input: { file_path: "/p/a.kt" },
        },
      ]),
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok" },
          ] as never,
        },
      },
      assistant("h2", [{ type: "text", text: "看完了" }]),
    ]);
    expect(m.items.map((i) => i.kind)).toEqual(["user", "tool", "assistant"]);
    expect(m.items[1]).toMatchObject({
      summary: "a.kt",
      result: { text: "ok" },
    });
  });

  it("notes an errored turn", () => {
    const m = new SdkChatModel();
    m.addUser("x");
    m.apply({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
    });
    expect(m.working).toBe(false);
    expect(m.items[m.items.length - 1]).toMatchObject({ kind: "note" });
  });
});
