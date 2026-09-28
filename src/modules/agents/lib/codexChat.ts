import type { ChatItem } from "./chatItems";

/**
 * `codex app-server` 的通知 → 聊天列表。纯状态机,不碰 IO:收到的每条通知
 * 按顺序 `notify`,UI 只读 `items` 和几个状态字段。
 *
 * - 每个 item 有 `item/started` 和 `item/completed`,中间回复文字靠
 *   `item/agentMessage/delta` 逐段拼;
 * - 命令、改文件画成和 Claude 一样的工具卡片(名字沿用 Bash / Edit);
 * - 用户自己发的话由 `addUser` 先放进来,实时流里的 userMessage 不再重复。
 */

export type CodexItem = {
  type?: string;
  id?: string;
  text?: string;
  content?: { type?: string; text?: string; path?: string }[];
  command?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: { path?: string; diff?: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: { content?: unknown[] } | null;
  error?: { message?: string } | null;
  query?: string;
  action?: { query?: string | null; url?: string | null };
};

export type CodexTurn = {
  id?: string;
  items?: CodexItem[];
  status?: string;
  error?: { message?: string } | null;
  startedAt?: number | null;
};

type Params = {
  item?: CodexItem;
  itemId?: string;
  delta?: string;
  turn?: CodexTurn;
  error?: { message?: string };
  willRetry?: boolean;
  message?: string;
};

/** Codex 把命令包成 `/bin/zsh -lc '...'` 交给 shell;卡片上只显示里面那句。 */
export function unwrapShell(command: string): string {
  const m = command.match(/^\S*\b(?:ba|z)?sh -lc '([\s\S]*)'$/);
  if (m) return m[1].replace(/'\\''/g, "'");
  const d = command.match(/^\S*\b(?:ba|z)?sh -lc "([\s\S]*)"$/);
  return d ? d[1].replace(/\\"/g, '"') : command;
}

const basename = (p: string) => p.split("/").pop() ?? p;

function settled(status: string | undefined): boolean {
  return !!status && status !== "inProgress";
}

function mcpText(result: CodexItem["result"]): string {
  const parts = result?.content ?? [];
  return parts
    .map((c) =>
      c &&
      typeof c === "object" &&
      typeof (c as { text?: unknown }).text === "string"
        ? (c as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** 一个 Codex item 画成什么;不需要显示的(推理过程、钩子)返回 null。 */
export function codexItemToChat(
  it: CodexItem,
  ts: number,
  streaming: boolean,
): ChatItem | null {
  const id = it.id ?? "";
  switch (it.type) {
    case "userMessage": {
      const text = (it.content ?? [])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string)
        .join("\n")
        .trim();
      const attachments = (it.content ?? [])
        .filter((c) => c.type === "localImage" && c.path)
        .map((c) => c.path as string);
      if (!text && !attachments.length) return null;
      return {
        kind: "user",
        id,
        text,
        ts,
        ...(attachments.length ? { attachments } : {}),
      };
    }
    case "agentMessage":
      return {
        kind: "assistant",
        id,
        text: it.text ?? "",
        ts,
        ...(streaming ? { streaming: true } : {}),
      };
    case "commandExecution": {
      const command = unwrapShell(it.command ?? "");
      return {
        kind: "tool",
        id,
        name: "Bash",
        summary: command,
        input: { command },
        result: settled(it.status)
          ? {
              text:
                it.status === "declined"
                  ? "已拒绝"
                  : (it.aggregatedOutput ?? "").trimEnd(),
              isError: it.status !== "completed" || (it.exitCode ?? 0) !== 0,
            }
          : null,
        ts,
      };
    }
    case "fileChange": {
      const changes = it.changes ?? [];
      const paths = changes.map((c) => c.path ?? "").filter(Boolean);
      return {
        kind: "tool",
        id,
        name: "Edit",
        summary: paths.map(basename).join(", "),
        input: {
          file_path: paths.join("\n"),
          diff: changes.map((c) => c.diff ?? "").join("\n"),
        },
        result: settled(it.status)
          ? {
              text: it.status === "declined" ? "已拒绝" : "",
              isError: it.status !== "completed",
            }
          : null,
        ts,
      };
    }
    case "mcpToolCall": {
      const args =
        it.arguments && typeof it.arguments === "object"
          ? (it.arguments as Record<string, unknown>)
          : {};
      return {
        kind: "tool",
        id,
        name: `${it.server ?? "mcp"}.${it.tool ?? ""}`,
        summary: "",
        input: args,
        result: settled(it.status)
          ? it.error
            ? { text: it.error.message ?? "失败", isError: true }
            : { text: mcpText(it.result), isError: it.status === "failed" }
          : null,
        ts,
      };
    }
    case "webSearch": {
      const query = it.query || it.action?.query || it.action?.url || "";
      return {
        kind: "tool",
        id,
        name: "WebSearch",
        summary: query,
        input: { query },
        result: null,
        ts,
      };
    }
    default:
      return null;
  }
}

export class CodexChatModel {
  items: ChatItem[] = [];
  threadId: string | null = null;
  /** 进行中的那一轮;中断要带上它。 */
  turnId: string | null = null;
  model: string | null = null;
  /** 推理强度(low / medium …);null = 模型默认。 */
  effort: string | null = null;
  /** 服务档位:"priority" 是快速,"default"/null 是标准。 */
  serviceTier: string | null = null;
  permissionMode: string | null = null;
  working = false;

  private index = new Map<string, number>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private put(item: ChatItem) {
    const at = this.index.get(item.id);
    if (at === undefined) {
      this.index.set(item.id, this.items.length);
      this.items.push(item);
    } else {
      this.items[at] = item;
    }
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

  /** 接着旧会话聊:`thread/resume` 带回来的各轮对话先铺上。 */
  loadHistory(turns: readonly CodexTurn[]) {
    for (const turn of turns) {
      const ts = turn.startedAt ? turn.startedAt * 1000 : 0;
      for (const it of turn.items ?? []) {
        const item = codexItemToChat(it, ts, false);
        if (item) this.put(item);
      }
    }
  }

  /** 流式中的回复都收尾(中断、出错时不会再有 completed)。 */
  private settleStreaming() {
    this.items = this.items.map((it) =>
      it.kind === "assistant" && it.streaming
        ? { ...it, streaming: false }
        : it,
    );
  }

  /** 返回是否有变化。 */
  notify(method: string, params: Params, ts = Date.now()): boolean {
    switch (method) {
      case "turn/started":
        this.working = true;
        this.turnId = params.turn?.id ?? null;
        return true;
      case "turn/completed": {
        this.working = false;
        this.turnId = null;
        this.settleStreaming();
        const turn = params.turn;
        if (turn?.status === "failed" && turn.error?.message) {
          this.addNote(`出错了:${turn.error.message}`, ts);
        } else if (turn?.status === "interrupted") {
          this.addNote("已中断", ts);
        }
        return true;
      }
      case "item/started":
      case "item/completed": {
        const it = params.item;
        // 实时流里的用户消息 addUser 已经放过了
        if (!it?.id || it.type === "userMessage") return false;
        const item = codexItemToChat(it, ts, method === "item/started");
        if (!item) return false;
        // 回复的时间取开始那一刻,收尾时不改
        const at = this.index.get(item.id);
        if (at !== undefined) item.ts = this.items[at].ts;
        this.put(item);
        return true;
      }
      case "item/agentMessage/delta": {
        const at = params.itemId ? this.index.get(params.itemId) : undefined;
        const cur = at === undefined ? undefined : this.items[at];
        if (at === undefined || cur?.kind !== "assistant" || !params.delta) {
          return false;
        }
        this.items[at] = { ...cur, text: cur.text + params.delta };
        return true;
      }
      case "error":
        if (params.willRetry) return false;
        this.addNote(`出错了:${params.error?.message ?? "未知错误"}`, ts);
        return true;
      default:
        return false;
    }
  }
}
