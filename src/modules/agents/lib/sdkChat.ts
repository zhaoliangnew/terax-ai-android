import {
  type ChatItem,
  markTurnDone,
  type ToolTask,
  toolSummary,
} from "./chatItems";
import {
  commandsFromInit,
  normalizeCommands,
  type SlashCommandOption,
} from "./slashCommands";

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
  /** init:下一次请求会用的推理强度(low…max);null = 不发强度参数。 */
  effort?: string | null;
  is_error?: boolean;
  result?: string;
  /** result:这一轮的用量;Qoder 在里面给上下文占比。task_*:子代理的用量。 */
  usage?: SdkUsage & { context_usage_ratio?: number } & TaskUsage;
  /** result:按模型的用量,带上下文窗口大小。 */
  modelUsage?: Record<string, { contextWindow?: number }>;
  /** system/init:可用的命令、技能名字;commands_changed:带说明的完整列表。 */
  slash_commands?: string[];
  skills?: string[];
  terminal_slash_commands?: string[];
  commands?: unknown[];
  /** system/status:"compacting" 表示正在压缩上下文;task_notification:结束状态。 */
  status?: string | null;
  /** system/task_*:子代理、后台命令这类任务,tool_use_id 指回拉起它的工具调用。 */
  task_id?: string;
  tool_use_id?: string;
  is_backgrounded?: boolean;
  last_tool_name?: string;
  summary?: string;
  /** 不算"在干活"的内务任务,界面不显示。 */
  ambient?: boolean;
  skip_transcript?: boolean;
  patch?: { status?: string; is_backgrounded?: boolean };
  /** system/compact_boundary:压缩前后的 token 数。 */
  compact_metadata?: { pre_tokens?: number; post_tokens?: number };
  /** Claude Code 自己塞的用户消息(压缩后的摘要等),不是用户说的话。 */
  isSynthetic?: boolean;
  event?: {
    type?: string;
    index?: number;
    message?: { id?: string };
    content_block?: Block;
    delta?: { type?: string; text?: string };
  };
  message?: { id?: string; content?: string | Block[]; usage?: SdkUsage };
};

type TaskUsage = {
  tool_uses?: number;
  duration_ms?: number;
};

type SdkUsage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
};

/** 当前上下文用了多少:token 数、窗口大小、占比(各家给的不全,有啥填啥)。 */
export type ContextUsage = {
  tokens: number | null;
  window: number | null;
  ratio: number | null;
};

function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join("\n");
}

function taskStatus(s: string | null | undefined): ToolTask["status"] | null {
  switch (s) {
    case "completed":
    case "failed":
      return s;
    case "stopped":
    case "killed":
      return "stopped";
    case "running":
    case "pending":
      return "running";
    default:
      return null;
  }
}

export class SdkChatModel {
  items: ChatItem[] = [];
  sessionId: string | null = null;
  model: string | null = null;
  permissionMode: string | null = null;
  /** 推理强度;null = 不知道 / 用默认。 */
  effort: string | null = null;
  /** ultracode 开关(和强度是两回事)。 */
  ultracode = false;
  /** 会话实际在用的强度(get_settings 报的);不指定时就是模型默认档。 */
  appliedEffort: string | null = null;
  /** 这个会话能不能开 ultracode。 */
  ultracodeAvailable = true;
  /** 一轮对话还没结束(从发出去到收到 result)。 */
  working = false;
  /** 正在压缩上下文(大会话要好几分钟)。 */
  compacting = false;
  context: ContextUsage | null = null;
  /** 输入 / 弹出的技能和命令;null = 还不知道。 */
  commands: SlashCommandOption[] | null = null;
  /** 已经拿到带说明的列表,init 里只有名字的那份不再覆盖它。 */
  private commandsDetailed = false;

  private toolIndex = new Map<string, number>();
  /** task_id → 拉起它的 tool_use_id(task_updated 只带 task_id)。 */
  private taskTool = new Map<string, string>();
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

  setCommands(raw: unknown) {
    this.commands = normalizeCommands(raw);
    this.commandsDetailed = true;
  }

  /** 本地处理掉的命令(不发给模型):用户那句和回复都直接放进对话里。 */
  addLocalExchange(question: string, answer: string, ts = Date.now()) {
    this.items.push({ kind: "user", id: this.nextId("u"), text: question, ts });
    this.items.push({
      kind: "assistant",
      id: this.nextId("a"),
      text: answer,
      ts,
    });
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
        if (text && !text.startsWith("<") && !msg.isSynthetic) {
          this.items.push({ kind: "user", id: this.nextId("u"), text, ts: 0 });
        }
        this.applyUser(msg);
      }
    }
  }

  /**
   * 返回是否有变化。子 agent(parent_tool_use_id 非空)的过程不展开成条目,
   * 只把"正在干什么"记到拉起它的那张工具卡片上。
   */
  apply(msg: SdkMessage, ts = Date.now()): boolean {
    if (msg.parent_tool_use_id) return this.applyChild(msg, ts);
    switch (msg.type) {
      case "system":
        if (msg.subtype?.startsWith("task_")) return this.applyTask(msg, ts);
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id ?? this.sessionId;
          this.model = msg.model ?? this.model;
          this.permissionMode = msg.permissionMode ?? this.permissionMode;
          // 有的版本在 init 里报实际强度;记成"实际",不动用户选的(auto 还是 auto)
          if (msg.effort !== undefined) this.appliedEffort = msg.effort;
          if (!this.commandsDetailed) this.commands = commandsFromInit(msg);
          return true;
        }
        if (msg.subtype === "status") {
          const next = msg.status === "compacting";
          if (next === this.compacting) return false;
          this.compacting = next;
          return true;
        }
        if (msg.subtype === "compact_boundary") {
          this.compacting = false;
          const pre = msg.compact_metadata?.pre_tokens;
          const post = msg.compact_metadata?.post_tokens;
          this.addNote(
            pre && post
              ? `上下文已压缩:${shortTokens(pre)} → ${shortTokens(post)} tokens`
              : "上下文已压缩",
            ts,
          );
          if (post) {
            const window = this.context?.window ?? null;
            this.context = {
              tokens: post,
              window,
              ratio: window ? post / window : null,
            };
          }
          return true;
        }
        if (msg.subtype === "commands_changed") {
          this.setCommands(msg.commands);
          return true;
        }
        return false;
      case "stream_event":
        return this.applyStream(msg, ts);
      case "assistant":
        this.trackPromptSize(msg.message?.usage);
        return this.applyAssistant(msg, ts);
      case "user":
        return this.applyUser(msg);
      case "result":
        this.working = false;
        this.compacting = false;
        markTurnDone(this.items, ts);
        this.trackResultContext(msg);
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

  /** 每次调模型的 usage:输入(含缓存)+ 输出就是眼下上下文有多大。 */
  private trackPromptSize(u: SdkUsage | undefined) {
    if (!u) return;
    const tokens =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.output_tokens ?? 0);
    if (tokens <= 0) return;
    const window = this.context?.window ?? null;
    this.context = {
      tokens,
      window,
      ratio: window ? tokens / window : null,
    };
  }

  /** 一轮结束:Claude 给窗口大小,Qoder 直接给占比。 */
  private trackResultContext(msg: SdkMessage) {
    const windows = Object.values(msg.modelUsage ?? {})
      .map((m) => m.contextWindow ?? 0)
      .filter((w) => w > 0);
    const window = windows.length
      ? Math.max(...windows)
      : (this.context?.window ?? null);
    const tokens = this.context?.tokens ?? null;
    const given = msg.usage?.context_usage_ratio;
    const ratio =
      typeof given === "number" && given > 0
        ? given
        : tokens && window
          ? tokens / window
          : null;
    if (tokens == null && ratio == null) return;
    this.context = { tokens, window, ratio };
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

  private patchTask(
    toolUseId: string | undefined,
    ts: number,
    update: (t: ToolTask) => Partial<ToolTask>,
  ): boolean {
    const i = toolUseId ? this.toolIndex.get(toolUseId) : undefined;
    const it = i === undefined ? undefined : this.items[i];
    if (it?.kind !== "tool") return false;
    const cur: ToolTask = it.task ?? {
      status: "running",
      background: false,
      startedAt: ts,
      toolUses: 0,
      durationMs: null,
      activity: "",
      summary: "",
    };
    this.items[i as number] = { ...it, task: { ...cur, ...update(cur) } };
    return true;
  }

  private applyTask(msg: SdkMessage, ts: number): boolean {
    if (msg.ambient || msg.skip_transcript) return false;
    const toolUseId =
      msg.tool_use_id ?? (msg.task_id ? this.taskTool.get(msg.task_id) : "");
    if (msg.task_id && msg.tool_use_id) {
      this.taskTool.set(msg.task_id, msg.tool_use_id);
    }
    const usage = (t: ToolTask): Partial<ToolTask> => ({
      toolUses: Math.max(t.toolUses, msg.usage?.tool_uses ?? 0),
      durationMs: msg.usage?.duration_ms ?? t.durationMs,
    });
    switch (msg.subtype) {
      case "task_started":
        return this.patchTask(toolUseId, ts, () => ({
          status: "running",
          background: msg.is_backgrounded === true,
          startedAt: ts,
        }));
      case "task_progress":
        return this.patchTask(toolUseId, ts, (t) => ({
          ...usage(t),
          activity: msg.summary || t.activity || msg.last_tool_name || "",
        }));
      case "task_updated": {
        const p = msg.patch ?? {};
        return this.patchTask(toolUseId, ts, (t) => ({
          background: p.is_backgrounded ?? t.background,
          status: taskStatus(p.status) ?? t.status,
        }));
      }
      case "task_notification":
        return this.patchTask(toolUseId, ts, (t) => ({
          ...usage(t),
          status: taskStatus(msg.status) ?? "completed",
          summary: msg.summary ?? "",
          durationMs: msg.usage?.duration_ms ?? ts - t.startedAt,
        }));
      default:
        return false;
    }
  }

  /** 子代理自己调了个工具:卡片上换成它正在干的事,工具次数加一。 */
  private applyChild(msg: SdkMessage, ts: number): boolean {
    if (msg.type !== "assistant") return false;
    const content = msg.message?.content;
    if (!Array.isArray(content)) return false;
    const calls = content.filter((b) => b.type === "tool_use" && b.name);
    const last = calls[calls.length - 1];
    if (!last?.name) return false;
    const what = toolSummary(last.name, last.input ?? {});
    return this.patchTask(msg.parent_tool_use_id ?? undefined, ts, (t) => ({
      toolUses: t.toolUses + calls.length,
      activity: what ? `${last.name} ${what}` : (last.name ?? ""),
    }));
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
      const isError = b.is_error === true;
      // 前台子代理的工具结果回来就是它做完了;后台的要等 task_notification
      const task =
        it.task?.status === "running" && !it.task.background
          ? {
              ...it.task,
              status: isError ? ("failed" as const) : ("completed" as const),
            }
          : it.task;
      this.items[i as number] = {
        ...it,
        result: { text: resultText(b.content), isError },
        ...(task ? { task } : {}),
      };
      changed = true;
    }
    return changed;
  }
}
