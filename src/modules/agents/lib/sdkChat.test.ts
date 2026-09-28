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
