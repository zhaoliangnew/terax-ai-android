import {
  MarkdownCode,
  markdownCodeText,
} from "@/components/ai-elements/markdown-code";
import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { localHtmlPath } from "@/modules/browser/lib/url";
import { openInBrowser } from "@/modules/browser/webTabsStore";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  ArrowDown02Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Globe02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ChatItem,
  chatTurns,
  isImagePath,
  type ToolTask,
} from "../lib/chatItems";
import { useSmoothText } from "../lib/useSmoothText";
import type { PermissionAsk } from "../store/claudeChatStore";
import { ImageThumb } from "./ImageLightbox";

type Props = {
  /** 聊天所在目录:回复里的相对路径(build/reports/index.html)按它补全。 */
  cwd?: string | null;
  items: ChatItem[];
  agentName: string;
  working: boolean;
  /** 正在压缩上下文(一轮进行中的特殊情况)。 */
  compacting?: boolean;
  /** 正在启动 / 已结束 / 启动失败时的一行提示;正常对话时为 null。 */
  statusText: string | null;
  /** Claude 等着确认的操作(可能不止一个)。 */
  permissions: PermissionAsk[];
  onPermission: (
    id: string,
    allow: boolean,
    always?: boolean,
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void;
  /** 选中一段文字点"添加到对话":作为引用塞进输入框。 */
  onQuote: (text: string) => void;
};

/**
 * 条目之间的间距(照 Codex):对话之间留大空,连着的工具调用挤紧一点,读起来
 * 才是"一问一答",而不是一长串等距的行。
 */
function gapAbove(item: ChatItem, prev: ChatItem | undefined): string {
  if (!prev) return "";
  if (item.kind === "tool") return prev.kind === "tool" ? "mt-1" : "mt-4";
  if (item.kind === "assistant" && prev.kind === "tool") return "mt-4";
  if (item.kind === "note") return "mt-6";
  return "mt-10";
}

/** 两条消息隔这么久,中间插一行时间。 */
const TIME_GAP_MS = 5 * 60 * 1000;
const RESULT_CAP = 6000;

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function clip(text: string): string {
  return text.length > RESULT_CAP
    ? `${text.slice(0, RESULT_CAP)}\n…(还有 ${text.length - RESULT_CAP} 字)`
    : text;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 回复里相对路径要按哪个目录补全。 */
const ChatCwd = createContext<string | null>(null);

/**
 * 回复里的行内代码:是 html 文件路径就能点,在右栏内嵌浏览器里打开;
 * 别的照常(代码块也照常)。
 */
function ChatCode({
  className,
  children,
  ...rest
}: {
  className?: string;
  children?: ReactNode;
}) {
  const cwd = useContext(ChatCwd);
  const path = className
    ? null
    : localHtmlPath(markdownCodeText(children), cwd);
  if (!path) {
    return (
      <MarkdownCode className={className} {...rest}>
        {children}
      </MarkdownCode>
    );
  }
  return (
    <button
      type="button"
      title={`在右栏浏览器里打开 ${path}`}
      onClick={() => openInBrowser(path)}
      className="cursor-pointer rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-[#6f9ce8] underline decoration-dotted underline-offset-2 hover:text-[#8fb3f0]"
    >
      {children}
    </button>
  );
}

const CHAT_COMPONENTS = { code: ChatCode };

/** 回复正文:流式输出时逐字放出来,不是一块一块往外蹦。 */
function AssistantText({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const shown = useSmoothText(text, streaming);
  const cwd = useContext(ChatCwd);
  return (
    // 指向本地 html 的链接(file://、绝对/相对路径)在右栏浏览器里打开;
    // 别的链接交给 Markdown 渲染器原来的处理
    <div
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        const path = a
          ? localHtmlPath(a.getAttribute("href") ?? "", cwd)
          : null;
        if (!path) return;
        e.preventDefault();
        e.stopPropagation();
        openInBrowser(path);
      }}
    >
      <MessageResponse components={CHAT_COMPONENTS}>{shown}</MessageResponse>
    </div>
  );
}

function ToolDetail({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const { name, input, result } = item;
  const pre =
    "max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-foreground/[0.04] px-3 py-2 font-mono text-[11.5px] leading-relaxed";
  let body: ReactNode;
  if (name === "Bash") {
    body = <div className={pre}>$ {str(input.command)}</div>;
  } else if (name === "Edit" && str(input.diff)) {
    // Codex 给的是现成的 unified diff,按行首符号上色
    body = (
      <div className={pre}>
        {clip(str(input.diff))
          .split("\n")
          .map((l, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 行内容会重复,只能按位置
              key={i}
              className={cn(
                l.startsWith("+") &&
                  !l.startsWith("+++") &&
                  "text-emerald-400/90",
                l.startsWith("-") && !l.startsWith("---") && "text-red-400/90",
                l.startsWith("@@") && "text-muted-foreground",
              )}
            >
              {l || " "}
            </div>
          ))}
      </div>
    );
  } else if (name === "Edit") {
    body = (
      <div className={pre}>
        {str(input.old_string)
          .split("\n")
          .map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 行内容会重复,只能按位置
            <div key={`o${i}`} className="text-red-400/90">
              - {l}
            </div>
          ))}
        {str(input.new_string)
          .split("\n")
          .map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同上
            <div key={`n${i}`} className="text-emerald-400/90">
              + {l}
            </div>
          ))}
      </div>
    );
  } else if (name === "Write") {
    body = <div className={pre}>{clip(str(input.content))}</div>;
  } else if (isSubagent(name) && str(input.prompt)) {
    body = <div className={pre}>{clip(str(input.prompt))}</div>;
  } else {
    body = <div className={pre}>{clip(JSON.stringify(input, null, 2))}</div>;
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 pl-5">
      <div className="text-[11px] text-muted-foreground/70">
        {str(input.file_path) || str(input.path) || ""}
      </div>
      {body}
      {result && name !== "Edit" && name !== "Write" && (
        <div className={cn(pre, result.isError && "text-red-400")}>
          {clip(result.text) || "(没有输出)"}
        </div>
      )}
      {result?.isError && (name === "Edit" || name === "Write") && (
        <div className={cn(pre, "text-red-400")}>{clip(result.text)}</div>
      )}
      {item.task?.summary && (
        <div
          className={cn(pre, item.task.status === "failed" && "text-red-400")}
        >
          {clip(item.task.summary)}
        </div>
      )}
    </div>
  );
}

const isSubagent = (name: string) => name === "Agent" || name === "Task";

function toolLabel(item: Extract<ChatItem, { kind: "tool" }>): string {
  if (!isSubagent(item.name)) return item.name;
  const type = str(item.input.subagent_type);
  return type && type !== "general-purpose" ? `子代理 ${type}` : "子代理";
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}小时${m % 60}分`;
}

/** 只在有任务跑着时挂上,每秒走一下;没有任务就没有定时器。 */
function useElapsed(since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now - since;
}

function useRunningText(task: ToolTask): string {
  const elapsed = useElapsed(task.startedAt);
  return [
    task.background ? "后台运行中" : "运行中",
    task.toolUses > 0 ? `${task.toolUses} 次工具` : "",
    duration(Math.max(elapsed, task.durationMs ?? 0)),
  ]
    .filter(Boolean)
    .join(" · ");
}

function TaskActivity({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60">
      {text}
    </span>
  );
}

function RunningTask({ task }: { task: ToolTask }) {
  const text = useRunningText(task);
  return (
    <div className="flex min-w-0 items-center gap-1.5 pl-[18px] text-[11.5px] text-muted-foreground/80">
      <Shimmer className="shrink-0">{text}</Shimmer>
      <TaskActivity text={task.activity} />
    </div>
  );
}

type RunningItem = Extract<ChatItem, { kind: "tool" }> & { task: ToolTask };

function DockRow({
  item,
  onJump,
}: {
  item: RunningItem;
  onJump: (id: string) => void;
}) {
  const text = useRunningText(item.task);
  return (
    <button
      type="button"
      title="跳到它在对话里的位置"
      onClick={() => onJump(item.id)}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
    >
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#6f9ce8]" />
      <span className="shrink-0 font-medium">{toolLabel(item)}</span>
      <span className="min-w-0 max-w-[40%] shrink truncate text-muted-foreground/80">
        {item.summary}
      </span>
      <span className="shrink-0 text-[11.5px] text-muted-foreground/70">
        {text}
      </span>
      <TaskActivity text={item.task.activity} />
    </button>
  );
}

/**
 * 输入框正上方常驻:还在跑的子代理 / 后台任务,一个一行,跑完自动消失。
 * 消息流里那一行会被聊天顶上去,这里一直看得见。
 */
function TaskDock({
  tasks,
  onJump,
}: {
  tasks: RunningItem[];
  onJump: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className="shrink-0 border-t border-border/60 bg-background">
      <div className="mx-auto flex max-h-36 max-w-3xl flex-col overflow-y-auto px-4 py-1.5">
        {tasks.map((t) => (
          <DockRow key={t.id} item={t} onJump={onJump} />
        ))}
      </div>
    </div>
  );
}

function TaskDone({ task }: { task: ToolTask }) {
  const label =
    task.status === "failed"
      ? "失败"
      : task.status === "stopped"
        ? "已停止"
        : "完成";
  const parts = [
    label,
    task.toolUses > 0 ? `${task.toolUses} 次工具` : "",
    task.durationMs ? duration(task.durationMs) : "",
  ].filter(Boolean);
  return (
    <span
      className={cn(
        "shrink-0 text-[11px]",
        task.status === "failed" ? "text-red-400" : "text-muted-foreground/60",
      )}
    >
      {parts.join(" · ")}
    </span>
  );
}

function ToolRow({
  item,
  running,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cwd = useContext(ChatCwd);
  // 写出/改了 html 文件的工具卡片:给个"打开",直接在右栏浏览器里看效果
  const htmlFile =
    item.name === "Write" || item.name === "Edit" || item.name === "MultiEdit"
      ? localHtmlPath(str(item.input.file_path), cwd)
      : null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex max-w-full cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={11}
          strokeWidth={2.25}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="shrink-0 font-medium">{toolLabel(item)}</span>
        <span className="min-w-0 truncate text-muted-foreground/80">
          {item.summary}
        </span>
        {htmlFile && (
          // biome-ignore lint/a11y/useSemanticElements: 整行已经是 <button>,里面不能再套 button
          <span
            role="button"
            tabIndex={0}
            title={`在右栏浏览器里打开 ${htmlFile}`}
            onClick={(e) => {
              e.stopPropagation();
              openInBrowser(htmlFile);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                openInBrowser(htmlFile);
              }
            }}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-[#6f9ce8] hover:bg-foreground/10"
          >
            <HugeiconsIcon icon={Globe02Icon} size={11} strokeWidth={2} />
            打开
          </span>
        )}
        {item.task && item.task.status !== "running" ? (
          <TaskDone task={item.task} />
        ) : (
          item.result?.isError && (
            <span className="shrink-0 text-[11px] text-red-400">失败</span>
          )
        )}
        {!item.result && running && !item.task && (
          <Shimmer className="shrink-0 text-[11px]">执行中</Shimmer>
        )}
      </button>
      {item.task?.status === "running" && <RunningTask task={item.task} />}
      {open && <ToolDetail item={item} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="复制"
      title="复制"
      onClick={() => {
        void copyToClipboard(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/10 hover:text-foreground"
    >
      <HugeiconsIcon
        icon={done ? Tick02Icon : Copy01Icon}
        size={13}
        strokeWidth={1.75}
      />
    </button>
  );
}

const TOOL_VERB: Record<string, string> = {
  Bash: "执行命令",
  Edit: "修改文件",
  MultiEdit: "修改文件",
  Write: "写入文件",
  Read: "读取文件",
  WebFetch: "访问网页",
  WebSearch: "联网搜索",
};

type AskQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label: string; description?: string }[];
};

/**
 * AI 用 AskUserQuestion 问你:把问题和选项画成能点的样子(不是一坨 JSON),
 * 选好了回答放进 updatedInput.answers 带回去(单选是选项名,多选用", "连起来)。
 * 单选题里"其他"也算一个选项:点方案清掉自己写的,写了就取消已选的方案。
 */
function QuestionCard({
  ask,
  onAnswer,
}: {
  ask: PermissionAsk;
  onAnswer: (
    allow: boolean,
    always?: boolean,
    updatedInput?: Record<string, unknown>,
  ) => void;
}) {
  const questions = (
    Array.isArray(ask.input.questions) ? ask.input.questions : []
  ) as AskQuestion[];
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const toggle = (qi: number, label: string, multi: boolean) => {
    if (!multi) setOther((cur) => ({ ...cur, [qi]: "" }));
    setPicked((cur) => {
      const now = cur[qi] ?? [];
      const next = multi
        ? now.includes(label)
          ? now.filter((l) => l !== label)
          : [...now, label]
        : [label];
      return { ...cur, [qi]: next };
    });
  };
  const answerOf = (qi: number) => {
    const typed = other[qi]?.trim();
    const labels = [...(picked[qi] ?? []), ...(typed ? [typed] : [])];
    return labels.join(", ");
  };
  const ready = questions.every((_, qi) => answerOf(qi) !== "");
  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, qi) => {
      answers[q.question] = answerOf(qi);
    });
    onAnswer(true, false, { ...ask.input, answers });
  };
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-sky-500/35 bg-sky-500/[0.05] p-4">
      {questions.map((q, qi) => (
        <div key={q.question} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            {q.header && (
              <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-300">
                {q.header}
              </span>
            )}
            <span className="text-[13.5px] font-medium">{q.question}</span>
            {q.multiSelect && (
              <span className="shrink-0 text-[11.5px] text-muted-foreground">
                可多选
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {(q.options ?? []).map((o) => {
              const on = (picked[qi] ?? []).includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(qi, o.label, !!q.multiSelect)}
                  className={cn(
                    "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    on
                      ? "border-sky-400/70 bg-sky-500/15"
                      : "border-border hover:bg-foreground/[0.06]",
                  )}
                >
                  <span className="text-[13px] font-medium">{o.label}</span>
                  {o.description && (
                    <span className="text-[12px] text-muted-foreground">
                      {o.description}
                    </span>
                  )}
                </button>
              );
            })}
            <input
              value={other[qi] ?? ""}
              onChange={(e) => {
                const text = e.target.value;
                setOther((cur) => ({ ...cur, [qi]: text }));
                if (!q.multiSelect && text.trim()) {
                  setPicked((cur) => ({ ...cur, [qi]: [] }));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) submit();
              }}
              placeholder="其他(自己写)"
              className="h-8 rounded-lg border border-border bg-transparent px-3 text-[12.5px] outline-none focus:border-ring"
            />
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="h-8 cursor-pointer rounded-lg bg-foreground px-3.5 text-[12.5px] font-medium text-background hover:bg-foreground/85 disabled:cursor-default disabled:opacity-40"
        >
          提交回答
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="h-8 cursor-pointer rounded-lg border border-border px-3.5 text-[12.5px] text-muted-foreground hover:bg-foreground/10"
        >
          不回答
        </button>
      </div>
    </div>
  );
}

/**
 * 计划模式做完、请你批准计划(ExitPlanMode):把计划按 Markdown 画出来;
 * 批准就开始动手,不批准可以写修改意见让它接着改计划。
 */
function PlanCard({
  ask,
  onAnswer,
}: {
  ask: PermissionAsk;
  onAnswer: (
    allow: boolean,
    always?: boolean,
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const plan = str(ask.input.plan);
  const keepPlanning = () =>
    onAnswer(
      false,
      false,
      undefined,
      feedback.trim()
        ? `先别执行,按这些意见改计划:${feedback.trim()}`
        : "先别执行,继续完善计划",
    );
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-violet-500/35 bg-violet-500/[0.05] p-4">
      <div className="flex items-center gap-2 text-[13.5px] font-medium">
        <span className="size-2 shrink-0 rounded-full bg-violet-400" />
        计划做好了,确认后开始执行
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-lg bg-foreground/[0.04] px-4 py-2 text-[13px]">
        <MessageResponse components={CHAT_COMPONENTS}>{plan}</MessageResponse>
      </div>
      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && feedback.trim()) keepPlanning();
        }}
        placeholder="有要改的地方?写在这里,点「继续规划」"
        className="h-8 rounded-lg border border-border bg-transparent px-3 text-[12.5px] outline-none focus:border-ring"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="h-8 cursor-pointer rounded-lg bg-foreground px-3.5 text-[12.5px] font-medium text-background hover:bg-foreground/85"
        >
          批准,开始执行
        </button>
        <button
          type="button"
          onClick={keepPlanning}
          className="h-8 cursor-pointer rounded-lg border border-border px-3.5 text-[12.5px] hover:bg-foreground/10"
        >
          继续规划
        </button>
      </div>
    </div>
  );
}

/** 改文件 / 写文件要确认时,把改动本身摆出来(不只一个路径)。 */
function EditPreview({ input }: { input: Record<string, unknown> }) {
  const edits: { old: string; neu: string }[] = Array.isArray(input.edits)
    ? (input.edits as Record<string, unknown>[]).map((e) => ({
        old: str(e.old_string),
        neu: str(e.new_string),
      }))
    : input.old_string !== undefined || input.new_string !== undefined
      ? [{ old: str(input.old_string), neu: str(input.new_string) }]
      : [];
  const content = str(input.content);
  if (!edits.length && !content) return null;
  const lines = (text: string, sign: "-" | "+") =>
    text.split("\n").map((l, i) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: 行号就是身份
        key={`${sign}${i}`}
        className={
          sign === "-"
            ? "bg-red-500/10 text-red-300"
            : "bg-emerald-500/10 text-emerald-300"
        }
      >
        {sign} {l}
      </div>
    ));
  return (
    <div className="max-h-64 overflow-auto rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-all">
      {content
        ? lines(clip(content), "+")
        : edits.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 顺序即身份
            <div key={i} className={i > 0 ? "mt-2" : ""}>
              {e.old && lines(clip(e.old), "-")}
              {lines(clip(e.neu), "+")}
            </div>
          ))}
    </div>
  );
}

/** Claude 要做某件事、等你点头:照 Codex 的确认卡片,把要做的事摆出来。 */
function PermissionCard({
  ask,
  onAnswer,
}: {
  ask: PermissionAsk;
  onAnswer: (allow: boolean, always?: boolean) => void;
}) {
  const detail =
    str(ask.input.command) ||
    str(ask.input.file_path) ||
    str(ask.input.url) ||
    str(ask.input.query) ||
    JSON.stringify(ask.input, null, 2);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-4">
      <div className="flex items-center gap-2 text-[13.5px] font-medium">
        <span className="size-2 shrink-0 rounded-full bg-amber-500" />
        {`需要确认:${TOOL_VERB[ask.toolName] ?? ask.toolName}`}
      </div>
      <div className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-foreground/[0.05] px-3 py-2 font-mono text-[12px]">
        {clip(detail)}
      </div>
      <EditPreview input={ask.input} />
      {str(ask.input.description) && (
        <div className="text-[12.5px] text-muted-foreground">
          {str(ask.input.description)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="h-8 cursor-pointer rounded-lg bg-foreground px-3.5 text-[12.5px] font-medium text-background hover:bg-foreground/85"
        >
          允许
        </button>
        {ask.canAlways && (
          <button
            type="button"
            onClick={() => onAnswer(true, true)}
            className="h-8 cursor-pointer rounded-lg border border-border px-3.5 text-[12.5px] hover:bg-foreground/10"
          >
            以后不再询问
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="h-8 cursor-pointer rounded-lg border border-border px-3.5 text-[12.5px] text-red-400 hover:bg-foreground/10"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

/**
 * Codex 样式的聊天视图:Claude Agent SDK 会话的消息流画成对话,回复逐字
 * 出来。只负责显示和确认;输入走窗格底部的输入框。
 */
export function AgentChatView({
  cwd = null,
  items,
  agentName,
  working,
  statusText,
  compacting = false,
  permissions,
  onPermission,
  onQuote,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => chatTurns(items), [items]);
  const runningTasks = useMemo(
    () =>
      items.filter(
        (i): i is RunningItem =>
          i.kind === "tool" && i.task?.status === "running",
      ),
    [items],
  );
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  // 选中文字后弹出的小工具条,坐标是滚动内容里的位置(跟着内容一起滚)
  const [selection, setSelection] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  const readSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    const box = scrollRef.current;
    if (!sel || !text || !box || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!box.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const r = range.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    // 界面有缩放时,量出来的是缩放后的像素,换回布局像素再用
    const scale = b.height / box.clientHeight || 1;
    setSelection({
      text,
      top: (r.top - b.top) / scale + box.scrollTop - 40,
      left: (r.left - b.left + r.width / 2) / scale,
    });
  };

  const jumpTo = (id: string) => {
    const box = scrollRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-turn="${id}"]`);
    if (!box || !el) return;
    stickRef.current = false;
    // 用 scrollIntoView,不自己算 offsetTop:后者依赖 offsetParent 是谁,
    // 容器结构一变就算歪
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    setActiveTurn(id);
  };

  // 视口上方 30% 那条线以上最后一个提问,就是"正在看的那一问"。用屏幕
  // 坐标比,不依赖 offsetParent
  const updateActiveTurn = (box: HTMLDivElement) => {
    const b = box.getBoundingClientRect();
    const line = b.top + b.height * 0.3;
    let current: string | null = turns[0]?.id ?? null;
    for (const t of turns) {
      const el = box.querySelector<HTMLElement>(`[data-turn="${t.id}"]`);
      if (el && el.getBoundingClientRect().top <= line) current = t.id;
    }
    setActiveTurn(current);
  };
  // 贴底跟随:人一往上滚就松开,滚回底部附近再重新贴上。以前每次渲染都
  // 拽回底部,流式输出时一秒刷几十次,根本翻不上去。
  const stickRef = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  /** 离底部还远:右下角挂一个"回到底部"。 */
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // 自己刚发了一条:不管之前翻到哪,都回到底部重新贴上 —— 发完还停在
  // 上面看旧内容,得自己再滚下去才看得到回复
  const lastTurnId = turns[turns.length - 1]?.id ?? null;
  const seenTurnRef = useRef(lastTurnId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容变了才需要跟到底
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (lastTurnId !== seenTurnRef.current) {
      seenTurnRef.current = lastTurnId;
      stickRef.current = true;
    }
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, working, permissions, statusText]);

  // Markdown、代码高亮、图片是渲染之后才把高度撑开的,只在消息变化时跟一下
  // 会停在半截(刚打开旧会话时最明显);高度一变、还贴着底就再跟一次
  useEffect(() => {
    const box = scrollRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const follow = () => {
      if (stickRef.current) box.scrollTop = box.scrollHeight;
    };
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const jumpToTool = (id: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-tool="${CSS.escape(id)}"]`,
    );
    if (!el) return;
    stickRef.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.animate(
      [
        { backgroundColor: "rgba(111, 156, 232, 0.16)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 1400, easing: "ease-out" },
    );
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const lastIndex = items.length - 1;
  const last = items[lastIndex];
  const replying = last?.kind === "assistant" && last.streaming === true;

  return (
    // z-10:压在终端(xterm 的几层画布自带层级)上面,滚轮和点击都归聊天
    <ChatCwd.Provider value={cwd}>
      <div className="absolute inset-0 z-10 flex flex-col bg-background">
        <div className="relative min-h-0 flex-1">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 鼠标只用来读选区、收起工具条,消息本身不可交互 */}
          <div
            ref={scrollRef}
            onWheel={(e) => {
              if (e.deltaY < 0) stickRef.current = false;
            }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
              if (gap < 24) stickRef.current = true;
              // 差一屏以上才算"离开了底部",贴底时的细小抖动不让按钮闪
              setAwayFromBottom(gap > el.clientHeight * 0.5);
              updateActiveTurn(el);
            }}
            // 点工具条上的按钮也会冒上来一个 mouseup:那时选区还在,不跳过的话
            // 刚收起的工具条又被弹出来
            onMouseUp={(e) => {
              if ((e.target as HTMLElement).closest("[data-selection-bar]"))
                return;
              setTimeout(readSelection, 0);
            }}
            onMouseDown={(e) => {
              if (!(e.target as HTMLElement).closest("[data-selection-bar]")) {
                setSelection(null);
              }
            }}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
          >
            {selection && (
              <div
                data-selection-bar=""
                style={{ top: selection.top, left: selection.left }}
                className="absolute z-30 flex -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-[12.5px] shadow-xl"
              >
                <button
                  type="button"
                  onClick={() => {
                    onQuote(selection.text);
                    setSelection(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  className="cursor-pointer px-2.5 py-1.5 hover:bg-foreground/10"
                >
                  添加到对话
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyToClipboard(selection.text);
                    setSelection(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  className="cursor-pointer border-l border-border px-2.5 py-1.5 hover:bg-foreground/10"
                >
                  复制
                </button>
              </div>
            )}
            {/* 全局默认不让选字(桌面应用的习惯),聊天内容要能选中复制 */}
            <div
              ref={contentRef}
              className="select-text mx-auto flex max-w-3xl cursor-text flex-col px-6 pt-8 pb-12"
            >
              {items.length === 0 && !working && !statusText && (
                <div className="pt-24 text-center text-[13px] text-muted-foreground">
                  给 {agentName} 发条消息开始吧
                </div>
              )}
              {items.map((item, i) => {
                const prev = items[i - 1];
                const showTime =
                  item.ts > 0 && (!prev || item.ts - prev.ts > TIME_GAP_MS);
                return (
                  <div
                    key={item.id}
                    data-turn={item.kind === "user" ? item.id : undefined}
                    data-tool={item.kind === "tool" ? item.id : undefined}
                    className={cn(
                      "flex scroll-mt-6 flex-col",
                      showTime ? "mt-10" : gapAbove(item, prev),
                    )}
                  >
                    {showTime && (
                      <div className="mb-6 text-center text-[12px] text-muted-foreground/70">
                        {timeLabel(item.ts)}
                      </div>
                    )}
                    {item.kind === "user" && (
                      <div className="flex justify-end">
                        <div className="group/user flex max-w-[80%] flex-col items-end gap-1.5">
                          {item.text && (
                            <div className="whitespace-pre-wrap break-words rounded-[18px] bg-[#173e77] px-4 py-2.5 text-[14px] leading-relaxed text-white">
                              {item.text}
                            </div>
                          )}
                          {item.attachments && (
                            <div className="flex flex-wrap justify-end gap-1">
                              {item.attachments.map((f) =>
                                isImagePath(f) ? (
                                  <ImageThumb
                                    key={f}
                                    path={f}
                                    className="max-h-20 max-w-32 rounded-lg border border-border object-cover"
                                  />
                                ) : (
                                  <span
                                    key={f}
                                    title={f}
                                    className="max-w-56 truncate rounded-md bg-foreground/[0.08] px-2 py-0.5 text-[11.5px] text-muted-foreground"
                                  >
                                    {f.split("/").pop()}
                                  </span>
                                ),
                              )}
                            </div>
                          )}
                          {item.text && (
                            <div className="-mr-1 flex opacity-0 transition-opacity group-hover/user:opacity-100">
                              <CopyButton text={item.text} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {item.kind === "assistant" && (
                      <div className="flex flex-col gap-1.5">
                        {/* Markdown 渲染默认的标题是大号字,放在对话里一个"##"就
                        比正文大一截;照 Codex 只比正文略大 */}
                        <div className="text-[14px] leading-[1.75] text-foreground/95 [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[16.5px] [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[15.5px] [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_h4]:text-[14px] [&_h4]:font-semibold [&_table]:text-[13px] [&_pre]:text-[12.5px]">
                          <AssistantText
                            text={item.text}
                            streaming={item.streaming === true}
                          />
                        </div>
                        <div className="-ml-1 flex gap-0.5">
                          <CopyButton text={item.text} />
                        </div>
                      </div>
                    )}
                    {item.kind === "tool" && (
                      <ToolRow
                        item={item}
                        running={working && i === lastIndex}
                      />
                    )}
                    {item.kind === "note" && (
                      <div className="text-center text-[11.5px] text-muted-foreground/70">
                        {item.text}
                      </div>
                    )}
                  </div>
                );
              })}
              {permissions.map((p) =>
                p.toolName === "ExitPlanMode" && str(p.input.plan) ? (
                  <PlanCard
                    key={p.id}
                    ask={p}
                    onAnswer={(allow, always, input, message) =>
                      onPermission(p.id, allow, always, input, message)
                    }
                  />
                ) : p.toolName === "AskUserQuestion" &&
                  Array.isArray(p.input.questions) ? (
                  <QuestionCard
                    key={p.id}
                    ask={p}
                    onAnswer={(allow, always, input) =>
                      onPermission(p.id, allow, always, input)
                    }
                  />
                ) : (
                  <PermissionCard
                    key={p.id}
                    ask={p}
                    onAnswer={(allow, always) =>
                      onPermission(p.id, allow, always)
                    }
                  />
                ),
              )}
              {statusText && (
                <div className="mt-6 text-center text-[12px] text-muted-foreground">
                  {statusText}
                </div>
              )}
              {/* 回复已经在往外流了就不再挂"正在思考":它在文字下面跟着一跳一跳 */}
              {working && permissions.length === 0 && !replying && (
                <Shimmer className="mt-4 text-[13px]">
                  {compacting
                    ? "正在压缩上下文,会话大的话要几分钟"
                    : "正在思考"}
                </Shimmer>
              )}
            </div>
          </div>
          {awayFromBottom && (
            <button
              type="button"
              title="回到底部"
              aria-label="回到底部"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 z-20 flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-lg transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowDown02Icon} size={15} strokeWidth={2} />
            </button>
          )}
          {turns.length > 1 && (
            <TurnRail turns={turns} active={activeTurn} onJump={jumpTo} />
          )}
        </div>
        <TaskDock tasks={runningTasks} onJump={jumpToTool} />
      </div>
    </ChatCwd.Provider>
  );
}

/**
 * 左边的对话导航(照 Codex):一问一条短线,当前看到的那条长一点、亮一点;
 * 悬停出卡片(问题 + 回答开头),点一下跳过去。
 */
function TurnRail({
  turns,
  active,
  onJump,
}: {
  turns: ReturnType<typeof chatTurns>;
  active: string | null;
  onJump: (id: string) => void;
}) {
  // 提问一多,横线从上到下排满一整列、压在正文上。最多露 RAIL_MAX 条,
  // 以正在看的那一问为中心滑动;两头还有的话淡淡标一下剩几条
  const activeIdx = Math.max(
    0,
    turns.findIndex((t) => t.id === active),
  );
  const start = Math.min(
    Math.max(0, activeIdx - Math.floor(RAIL_MAX / 2)),
    Math.max(0, turns.length - RAIL_MAX),
  );
  const shown = turns.slice(start, start + RAIL_MAX);
  const hiddenAbove = start;
  const hiddenBelow = turns.length - start - shown.length;
  return (
    <nav
      aria-label="对话导航"
      // group/rail:鼠标一进这一列,所有横线一起拉长(照 Codex)
      className="group/rail absolute top-1/2 left-3 z-20 flex -translate-y-1/2 flex-col"
    >
      {hiddenAbove > 0 && (
        <button
          type="button"
          title={`上面还有 ${hiddenAbove} 个提问`}
          onClick={() => onJump(turns[start - 1].id)}
          className="cursor-pointer pb-1 pl-1 text-left text-[9px] leading-none text-muted-foreground/60 tabular-nums hover:text-foreground"
        >
          +{hiddenAbove}
        </button>
      )}
      {shown.map((t) => {
        const on = t.id === active;
        return (
          <div key={t.id} className="group/turn relative">
            <button
              type="button"
              aria-label={t.question || "提问"}
              onClick={() => onJump(t.id)}
              // 横线本身很小,点击区域给足
              className="flex h-2.5 w-7 cursor-pointer items-center pl-1"
            >
              <span
                className={cn(
                  "h-[2px] w-2 rounded-full transition-all duration-150 group-hover/rail:w-5",
                  on
                    ? "bg-foreground"
                    : "bg-foreground/45 group-hover/turn:bg-foreground",
                )}
              />
            </button>
            <div className="pointer-events-none absolute top-1/2 left-8 hidden w-72 -translate-y-1/2 flex-col gap-1 rounded-xl border border-border bg-popover px-3.5 py-3 shadow-xl group-hover/turn:flex">
              <span className="truncate text-[13px] font-semibold">
                {t.question || "(附件)"}
              </span>
              {t.answer && (
                <span className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
                  {t.answer}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {hiddenBelow > 0 && (
        <button
          type="button"
          title={`下面还有 ${hiddenBelow} 个提问`}
          onClick={() => onJump(turns[start + shown.length].id)}
          className="cursor-pointer pt-1 pl-1 text-left text-[9px] leading-none text-muted-foreground/60 tabular-nums hover:text-foreground"
        >
          +{hiddenBelow}
        </button>
      )}
    </nav>
  );
}

/** 对话导航最多露几条横线。 */
const RAIL_MAX = 15;
