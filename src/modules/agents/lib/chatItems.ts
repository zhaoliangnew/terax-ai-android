/** 工具调用拉起的子代理 / 后台任务的状态,跟着 SDK 的 task_* 消息走。 */
export type ToolTask = {
  status: "running" | "completed" | "failed" | "stopped";
  /** 后台跑:主对话已经往下走了,它还在做。 */
  background: boolean;
  startedAt: number;
  toolUses: number;
  durationMs: number | null;
  /** 正在干什么:"Read Foo.kt"、或者 SDK 给的一行进度。 */
  activity: string;
  /** 结束时 SDK 给的一句总结。 */
  summary: string;
};

/** 聊天视图里的一条。 */
export type ChatItem =
  | {
      kind: "user";
      id: string;
      text: string;
      ts: number;
      /** 随消息附上的文件(绝对路径)。 */
      attachments?: string[];
      /** 这一轮从发出到回完用了多久;还没回完是 undefined。 */
      durationMs?: number;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;
      ts: number;
      /** 还在逐字往外流。 */
      streaming?: boolean;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      summary: string;
      input: Record<string, unknown>;
      result: { text: string; isError: boolean } | null;
      ts: number;
      task?: ToolTask;
    }
  | { kind: "note"; id: string; text: string; ts: number };

/** 能直接给模型看、也能在界面上显示成小图的附件。 */
export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(p);
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** 工具卡片上那一行说明:命令、文件名、搜索词……认不出就空着。 */
export function toolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  const s = (k: string) => (typeof input[k] === "string" ? input[k] : "");
  switch (name) {
    case "Bash":
      return s("description") || s("command");
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return basename(s("file_path") || s("notebook_path"));
    case "Grep":
    case "Glob":
      return s("pattern");
    case "WebFetch":
      return s("url");
    case "WebSearch":
      return s("query");
    default:
      return s("description");
  }
}

/** 左侧导航条上的一格:一问,加上它得到的第一段回答(去掉 Markdown 符号)。 */
export type ChatTurn = { id: string; question: string; answer: string };

function plain(md: string): string {
  return (
    md
      .replace(/```[\s\S]*?```/g, " ")
      // 只去强调符号;单个下划线常在标识符里(app_x),不能动
      .replace(/__/g, "")
      .replace(/[`*#>|]/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function chatTurns(items: readonly ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;
  for (const it of items) {
    if (it.kind === "user") {
      const names = it.attachments?.map((f) => f.split("/").pop()).join(", ");
      current = {
        id: it.id,
        question: it.text.trim() || (names ? `附件:${names}` : ""),
        answer: "",
      };
      turns.push(current);
    } else if (it.kind === "assistant" && current && !current.answer) {
      current.answer = plain(it.text);
    }
  }
  return turns;
}

/**
 * 一轮结束:给最后一条还没记用时的用户消息记上"从发出到回完"的用时
 * (照 Codex 在回复上方写"用时 1分钟 29秒")。返回是否有改动。
 */
export function markTurnDone(items: ChatItem[], endTs: number): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "user") continue;
    if (it.durationMs !== undefined) return false;
    items[i] = { ...it, durationMs: Math.max(0, endTs - it.ts) };
    return true;
  }
  return false;
}

/** 用时写成"1分钟 29秒"/"12秒"/"1小时 3分钟"。 */
export function formatTurnDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}分钟 ${s % 60}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}小时 ${m % 60}分钟` : `${h}小时`;
}
