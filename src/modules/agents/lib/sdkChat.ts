import { type ChatItem, toolSummary } from "./chatItems";

/**
 * Claude Agent SDK 的消息流 → 聊天列表。纯状态机,不碰 IO:桥接进程转过来
 * 的每条 SDK 消息按顺序 `apply`,UI 只读 `items` 和几个状态字段。
 *
 * - `stream_event` 里的 text_delta 逐字拼到一条"流式中"的回复上;
 * - 完整的 `assistant` 消息到了,用完整文本替换掉流式拼出来的那条;
 * - `tool_use` 变成工具卡片,`user` 消息里的 `tool_result` 补回到卡片上;
 * - 用户自己发的话由 `addUser` 先放进来,不等 SDK 回显。
 */

type Block = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

export type SdkMessage = {
  type?: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  model?: string;
  permissionMode?: string;
  is_error?: boolean;
  result?: string;
  event?: {
    type?: string;
    index?: number;
    message?: { id?: string };
    content_block?: Block;
    delta?: { type?: string; text?: string };
  };
  message?: { id?: string; content?: string | Block[] };
};

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
}

export class SdkChatModel {
  items: ChatItem[] = [];
  sessionId: string | null = null;
  model: string | null = null;
  permissionMode: string | null = null;
  /** 一轮对话还没结束(从发出去到收到 result)。 */
  working = false;

  private toolIndex = new Map<string, number>();
  /** 流式拼出来的回复:`message id:块序号` → items 下标。 */
  private streamIndex = new Map<string, number>();
  /**
   * 同一条消息里还没被完整文本替换掉的流式回复,按出现顺序排队。完整的
   * `assistant` 消息是一个内容块一条发过来的(content 里只有这一块,序号对
   * 不上流式事件里的 index),所以按消息 id + 先后顺序配对。
   */
  private unsettled = new Map<string, number[]>();
  private currentMessageId: string | null = null;
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  addUser(text: string, attachments: string[] = [], ts = Date.now()) {
    this.items.push({
      kind: "user",
      id: this.nextId("u"),
      text,
      ts,
      ...(attachments.length ? { attachments } : {}),
    });
    this.working = true;
  }

  addNote(text: string, ts = Date.now()) {
    this.items.push({ kind: "note", id: this.nextId("n"), text, ts });
  }

  /**
   * 接着旧会话聊时,把之前的对话(从会话记录读出来的)先铺上。用户那边的
   * 纯文本也要显示 —— 实时流里用户消息是 `addUser` 自己放的,不会回显。
   * 以 `<` 开头的是 Claude Code 自己塞的命令/提醒标签,不当成用户说的话。
   */
  loadHistory(messages: readonly SdkMessage[]) {
    for (const msg of messages) {
      if (msg.parent_tool_use_id) continue;
      if (msg.type === "assistant") {
        this.applyAssistant(msg, 0);
      } else if (msg.type === "user") {
        const content = msg.message?.content;
        const texts =
          typeof content === "string"
            ? [content]
            : Array.isArray(content)
              ? content
                  .filter((b) => b.type === "text" && b.text)
                  .map((b) => b.text as string)
              : [];
        const text = texts.join("\n").trim();
        if (text && !text.startsWith("<")) {
          this.items.push({ kind: "user", id: this.nextId("u"), text, ts: 0 });
        }
        this.applyUser(msg);
      }
    }
  }

  /** 返回是否有变化。子 agent(parent_tool_use_id 非空)的过程不展开。 */
  apply(msg: SdkMessage, ts = Date.now()): boolean {
    if (msg.parent_tool_use_id) return false;
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id ?? this.sessionId;
          this.model = msg.model ?? this.model;
          this.permissionMode = msg.permissionMode ?? this.permissionMode;
          return true;
        }
        return false;
      case "stream_event":
        return this.applyStream(msg, ts);
      case "assistant":
        return this.applyAssistant(msg, ts);
      case "user":
        return this.applyUser(msg);
      case "result":
        this.working = false;
        for (const i of this.streamIndex.values()) {
          const it = this.items[i];
          if (it?.kind === "assistant")
            this.items[i] = { ...it, streaming: false };
        }
        this.streamIndex.clear();
        this.unsettled.clear();
        if (msg.is_error && msg.subtype !== "success") {
          this.addNote(
            msg.result ? `出错了:${msg.result}` : "这一轮出错了",
            ts,
          );
        }
        return true;
      default:
        return false;
    }
  }

  private applyStream(msg: SdkMessage, ts: number): boolean {
    const e = msg.event;
    if (!e) return false;
    if (e.type === "message_start") {
      this.currentMessageId = e.message?.id ?? null;
      return false;
    }
    if (e.type !== "content_block_delta" || e.delta?.type !== "text_delta") {
      return false;
    }
    const key = `${this.currentMessageId ?? "m"}:${e.index ?? 0}`;
    const text = e.delta.text ?? "";
    const i = this.streamIndex.get(key);
    const it = i === undefined ? undefined : this.items[i];
    if (it?.kind === "assistant") {
      this.items[i as number] = { ...it, text: it.text + text };
    } else {
      this.items.push({
        kind: "assistant",
        id: `a-${key}`,
        text,
        ts,
        streaming: true,
      });
      const index = this.items.length - 1;
      this.streamIndex.set(key, index);
      const msgId = this.currentMessageId ?? "m";
      const queue = this.unsettled.get(msgId) ?? [];
      queue.push(index);
      this.unsettled.set(msgId, queue);
    }
    return true;
  }

  private applyAssistant(msg: SdkMessage, ts: number): boolean {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return false;
    const msgId = msg.message?.id ?? msg.uuid ?? this.nextId("m");
    let changed = false;
    for (const b of content) {
      if (b.type === "text" && b.text?.trim()) {
        const queue = this.unsettled.get(msgId);
        const i = queue?.shift();
        const it = i === undefined ? undefined : this.items[i];
        if (it?.kind === "assistant") {
          this.items[i as number] = { ...it, text: b.text, streaming: false };
        } else {
          this.items.push({
            kind: "assistant",
            id: this.nextId("a"),
            text: b.text,
            ts,
          });
        }
        changed = true;
      } else if (b.type === "tool_use" && b.id && b.name) {
        if (this.toolIndex.has(b.id)) continue;
        const input = b.input ?? {};
        this.items.push({
          kind: "tool",
          id: b.id,
          name: b.name,
          summary: toolSummary(b.name, input),
          input,
          result: null,
          ts,
        });
        this.toolIndex.set(b.id, this.items.length - 1);
        changed = true;
      }
    }
    return changed;
  }

  private applyUser(msg: SdkMessage): boolean {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return false;
    let changed = false;
    for (const b of content) {
      if (b.type !== "tool_result" || !b.tool_use_id) continue;
      const i = this.toolIndex.get(b.tool_use_id);
      const it = i === undefined ? undefined : this.items[i];
      if (it?.kind !== "tool") continue;
      this.items[i as number] = {
        ...it,
        result: { text: resultText(b.content), isError: b.is_error === true },
      };
      changed = true;
    }
    return changed;
  }
}
