import { useImeGuard } from "@/lib/ime";
import { useArmedConfirm } from "@/lib/useArmedConfirm";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  BookOpen01Icon,
  Bug01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  CodeIcon,
  FileSearchIcon,
  FolderSearchIcon,
  GitBranchIcon,
  GitCommitIcon,
  Hold02Icon,
  Idea01Icon,
  MagicWand01Icon,
  Message01Icon,
  PackageIcon,
  PaintBoardIcon,
  PencilEdit02Icon,
  PlayIcon,
  PlusSignIcon,
  Refresh01Icon,
  SentIcon,
  Settings02Icon,
  Shield01Icon,
  StopIcon,
  Task01Icon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { isImagePath } from "../lib/chatItems";
import { findModel, modelIdName } from "../lib/modelMatch";
import {
  groupQuickPrompts,
  type QuickPrompt,
  useQuickPrompts,
} from "../lib/quickPrompts";
import type { ContextUsage } from "../lib/sdkChat";
import {
  commandQuery,
  matchCommands,
  type SlashCommandOption,
} from "../lib/slashCommands";
import type { UsageInfo } from "../lib/usage";
import { AGENT_NAMES, type ChatAgent } from "../store/chatProviders";
import type { ModelOption } from "../store/claudeChatStore";
import { ClaudeModelPanel } from "./ClaudeModelPanel";
import { CodexModelPanel, effortLabel } from "./CodexModelPanel";
import { ImageThumb } from "./ImageLightbox";
import {
  QuickPromptFillDialog,
  quickPromptBlanks,
} from "./QuickPromptFillDialog";
import { QuickPromptsDialog } from "./QuickPromptsDialog";
import { UsagePanel } from "./UsagePanel";

type Props = {
  /** 聊天接的是谁:权限菜单的选项、各处的称呼跟着变。 */
  agent: ChatAgent;
  /** 一轮对话进行中:输入框为空时发送键变成"停止"。 */
  working: boolean;
  /** 发消息;附件是用系统文件框选的绝对路径。 */
  onSend: (text: string, attachments: string[]) => void;
  onStop: () => void;
  permissionMode: string | null;
  onSetMode: (mode: string) => void;
  /** 当前模型 id(init 里带的,或刚切过去的)。 */
  model: string | null;
  models: ModelOption[];
  /** 打开模型菜单时再去问一次可用模型,不预先拉。 */
  onOpenModels: () => void;
  onSetModel: (model: string) => void;
  onCompact: () => void;
  onNewChat: () => void;
  /** 从聊天里"添加到对话"过来的引用;n 变了就追加一次。 */
  quote?: { text: string; n: number } | null;
  /** 从投屏批注等处注入的一条(文字 + 附件);n 变了就并进来一次。 */
  injection?: {
    text: string;
    attachments: string[];
    items: { thumb: string; note: string }[];
    n: number;
  } | null;
  /** Codex 才有:推理强度、快速档。 */
  effort?: string | null;
  serviceTier?: string | null;
  onSetEffort?: (effort: string) => void;
  /** Claude 的 ultracode 开关(和强度是两个设置)。 */
  ultracode?: boolean;
  onSetUltracode?: (on: boolean) => void;
  /** Claude 会话实际在用的强度(auto 时是模型默认档)。 */
  appliedEffort?: string | null;
  ultracodeAvailable?: boolean;
  onSetServiceTier?: (tier: string) => void;
  /** 套餐用量:打开面板时去查,undefined = 还在查。 */
  usage?: UsageInfo | null;
  /** 紧凑的一行(右栏浮动聊天框里用,照 Codex):＋、输入、发送,别的都收起。 */
  compact?: boolean;
  /** 当前上下文大小和占比(底栏"用量"前面显示)。 */
  context?: ContextUsage | null;
  /** 输入框上方显示的当前分支;在 worktree 里再带上 worktree 名。 */
  branch?: {
    name: string;
    worktree: string | null;
    changed: number;
  } | null;
  /** 点分支:切到右栏仓库 tab;点未提交文件数时 commit=true,直接弹提交框。 */
  onOpenRepo?: (commit?: boolean) => void;
  onOpenUsage: () => void;
  /** 输入 / (Codex 是 $)能选的技能和命令;undefined = 还在读。 */
  commands?: SlashCommandOption[];
  /** 选择菜单弹出来时去拉一次最新的列表。 */
  onOpenCommands?: () => void;
  /** 正在压缩上下文:压缩按钮显示进行中。 */
  compacting?: boolean;
};

type ModeOption = {
  mode: string;
  /** 输入框左下角按钮上的短名字。 */
  label: string;
  title: string;
  hint: string;
  icon: typeof Shield01Icon;
  danger?: boolean;
};

/** 权限菜单(照 Codex 的"应如何批准"):图标 + 名字 + 一句话说明。 */
const CLAUDE_MODES: ModeOption[] = [
  {
    mode: "default",
    label: "默认权限",
    title: "请求批准",
    hint: "改文件、执行命令前都先问你",
    icon: Hold02Icon,
  },
  {
    mode: "acceptEdits",
    label: "自动接受修改",
    title: "自动接受修改",
    hint: "直接改文件,执行命令前再问你",
    icon: PencilEdit02Icon,
  },
  {
    mode: "plan",
    label: "计划模式",
    title: "计划模式",
    hint: "只读代码、出方案,不做任何修改",
    icon: Task01Icon,
  },
  {
    mode: "bypassPermissions",
    label: "完全访问",
    title: "完全访问权限",
    hint: "不再询问,可以执行任何命令、修改任何文件",
    icon: AlertCircleIcon,
    danger: true,
  },
];

/** Codex 的是沙箱 + 审批策略的三档组合,和 Codex 桌面版一致。 */
const CODEX_MODES: ModeOption[] = [
  {
    mode: "readonly",
    label: "只读",
    title: "只读",
    hint: "只看代码、回答问题;要改文件或执行命令先问你",
    icon: Task01Icon,
  },
  {
    mode: "auto",
    label: "默认权限",
    title: "默认权限",
    hint: "可以改这个项目里的文件、执行命令;越出项目或联网先问你",
    icon: Hold02Icon,
  },
  {
    mode: "full",
    label: "完全访问",
    title: "完全访问权限",
    hint: "不再询问,可以执行任何命令、修改任何文件、联网",
    icon: AlertCircleIcon,
    danger: true,
  },
];

/** 12.3k / 1.2M 这种短写法。 */
function shortTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** 底栏上的上下文占用:小圆环 + 百分比,悬停看 token 数。 */
function ContextMeter({ context }: { context?: ContextUsage | null }) {
  if (!context || context.ratio == null) {
    if (!context?.tokens) return null;
    return (
      <span
        title="当前上下文大小"
        className="px-1 text-[12px] tabular-nums text-muted-foreground"
      >
        上下文 {shortTokens(context.tokens)}
      </span>
    );
  }
  const pct = Math.min(100, Math.max(0, context.ratio * 100));
  const tokens =
    context.tokens ??
    (context.window ? Math.round(context.ratio * context.window) : null);
  const detail =
    tokens && context.window
      ? `${shortTokens(tokens)} / ${shortTokens(context.window)} tokens`
      : tokens
        ? `${shortTokens(tokens)} tokens`
        : "";
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <span
      title={`当前上下文 ${Math.round(pct)}%${detail ? `(${detail})` : ""}。满了可以点"压缩"`}
      className="flex h-7 items-center gap-1 pl-1 text-[12px] tabular-nums text-muted-foreground"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="2"
          className="stroke-foreground/15"
        />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 7 7)"
          className={
            pct >= 85
              ? "stroke-red-400"
              : pct >= 60
                ? "stroke-amber-400"
                : "stroke-foreground/60"
          }
        />
      </svg>
      {Math.round(pct)}%
    </span>
  );
}

/** 输入框底栏上的文字小按钮(用量、压缩、新会话)。 */
const toolText =
  "flex h-7 cursor-pointer items-center whitespace-nowrap rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

/** 模型菜单还没拉回来时,按 id 给个能读的名字。 */
function modelLabel(
  model: string | null,
  models: ModelOption[],
  fallback: string,
): string {
  if (!model) {
    // 还没收到会话的初始化消息(刚恢复的会话要等第一轮):用的就是默认模型
    const def = models.find((m) => m.value === "default");
    return (def && modelNameOf(def)) || fallback;
  }
  const hit = findModel(model, models);
  // 菜单项名字是"Opus (1M context)"这种不带版本的,按钮上用说明里的
  // 具体型号("Opus 5.5 with 1M context" → Opus 5.5 1M)
  if (hit) return modelNameOf(hit) || hit.displayName;
  return modelIdName(model);
}

/** 从模型说明里取具体型号:"Opus 5.5 with 1M context · …" → "Opus 5.5 1M"。 */
function modelNameOf(m: ModelOption): string {
  if (!m.description) return "";
  const name = shortDescription(m.description)
    .replace(/ with 1M context$/i, " 1M")
    .trim();
  // 只认"型号 + 版本号"开头的(Claude 的写法);Codex 的说明是一句介绍,不能拿来当名字
  return /^[A-Z][a-z]+ \d/.test(name) ? name : "";
}

/** 模型说明只留"是哪个模型"那半句,"适合干什么"的长句不要。 */
function shortDescription(description: string): string {
  return description.split(" · ")[0].trim();
}

/**
 * 贴在按钮正上方的小菜单,就画在按钮旁边,不走弹层。弹层组件在这里会一闪
 * 一闪:输入框在界面缩放(95%)的区域里,弹层在缩放区域外,两边坐标对不上,
 * 定位来回翻;弹层自带的焦点接管又和下面的终端抢焦点。点外面、按 Esc 关。
 */
function InlineMenu({
  open,
  onClose,
  align = "start",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // 点的是菜单或它自己的按钮就不管,按钮会自己开合
      const host = ref.current?.parentElement;
      if (host && !host.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        "absolute bottom-full z-30 mb-2 flex flex-col overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 分组摊成两列:按顺序往下排,累计条数过半(组标题算一条)就换到右列,
 * 两列高度差不多、组的先后顺序不乱。
 */
function splitQuickColumns<T extends { items: unknown[] }>(groups: T[]): T[][] {
  const weight = (g: T) => g.items.length + 1;
  const half = groups.reduce((n, g) => n + weight(g), 0) / 2;
  const left: T[] = [];
  const right: T[] = [];
  let acc = 0;
  for (const g of groups) {
    // 一旦换到右列就一直往右放,组的先后顺序不乱
    const toLeft =
      right.length === 0 && (left.length === 0 || acc + weight(g) / 2 <= half);
    if (toLeft) {
      left.push(g);
      acc += weight(g);
    } else right.push(g);
  }
  return [left, right];
}

/** 内置快捷指令的图标(自己加的用通用图标)。 */
const QUICK_PROMPT_ICONS: Record<string, typeof CodeIcon> = {
  review: CodeIcon,
  fix: Wrench01Icon,
  sync: Refresh01Icon,
  verify: CheckmarkCircle02Icon,
  debug: Bug01Icon,
  explain: BookOpen01Icon,
  commit: GitCommitIcon,
  summary: Task01Icon,
  plan: Idea01Icon,
  continue: PlayIcon,
  project: FolderSearchIcon,
  push: CloudUploadIcon,
  install: PackageIcon,
  "req-review": FileSearchIcon,
  design: PaintBoardIcon,
  "design-polish": MagicWand01Icon,
  "dt-check": Message01Icon,
  "dt-reply": SentIcon,
};

function MenuItem({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[12.5px] whitespace-nowrap hover:bg-foreground/10",
        active && "font-semibold",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 聊天视图底部的输入框(照 Codex 的样子)。发送、停止、切模型、切权限模式
 * 都直接走聊天会话(Claude Agent SDK),不用碰终端。
 */
export function AgentComposer({
  agent,
  working,
  onSend,
  onStop,
  permissionMode,
  onSetMode,
  model,
  models,
  onOpenModels,
  onSetModel,
  onCompact,
  onNewChat,
  quote,
  injection = null,
  effort = null,
  ultracode = false,
  onSetUltracode,
  appliedEffort = null,
  ultracodeAvailable = true,
  serviceTier = null,
  onSetEffort,
  onSetServiceTier,
  usage,
  branch,
  onOpenRepo,
  context,
  compact = false,
  onOpenUsage,
  commands,
  onOpenCommands,
  compacting = false,
}: Props) {
  const agentName = AGENT_NAMES[agent];
  const modeOptions = agent === "codex" ? CODEX_MODES : CLAUDE_MODES;
  const currentMode = modeOptions.find((o) => o.mode === permissionMode);
  const [text, setText] = useState("");
  const { imeProps, isImeKey } = useImeGuard();
  const [menu, setMenu] = useState<"mode" | "model" | "usage" | "quick" | null>(
    null,
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleMenu = (m: "mode" | "model" | "usage" | "quick") =>
    setMenu((cur) => (cur === m ? null : m));
  const [attachments, setAttachments] = useState<string[]>([]);
  const pickFiles = async () => {
    try {
      const picked = await invoke<string[]>("chat_pick_files");
      if (picked.length) {
        setAttachments((cur) => [
          ...cur,
          ...picked.filter((p) => !cur.includes(p)),
        ]);
      }
    } catch {
      // 取消或不支持:什么都不做
    }
    inputRef.current?.focus();
  };
  const attachPastedImages = async (images: File[]) => {
    for (const img of images) {
      try {
        const ext = img.type.split("/")[1] ?? "png";
        const path = await invoke<string>(
          "chat_save_image",
          new Uint8Array(await img.arrayBuffer()),
          { headers: { "x-ext": ext } },
        );
        setAttachments((cur) => (cur.includes(path) ? cur : [...cur, path]));
      } catch (e) {
        toast.error(`截图没贴上:${String(e)}`);
      }
    }
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 分屏时每个窗格都有一个输入框,label 要对得上各自的那个
  const inputId = useId();

  // 输入框随内容长高,最多 8 行,再多就在框里滚
  // biome-ignore lint/correctness/useExhaustiveDependencies: text 是重新量高度的信号
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 21 + 8)}px`;
  }, [text]);

  // 引用进来的文字变成 Markdown 引用块,光标放到末尾接着写
  const lastQuote = useRef(quote?.n ?? 0);
  useEffect(() => {
    if (!quote || quote.n === lastQuote.current) return;
    lastQuote.current = quote.n;
    const block = quote.text
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    setText((cur) => `${cur.trim() ? `${cur.trimEnd()}\n\n` : ""}${block}\n\n`);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [quote]);

  // 投屏批注:挂成"N 条注释"芯片(不塞进输入框),截图进附件区,发送时并进消息
  const [annotations, setAnnotations] = useState<{
    text: string;
    items: { thumb: string; note: string }[];
  } | null>(null);
  const lastInjection = useRef(injection?.n ?? 0);
  useEffect(() => {
    if (!injection || injection.n === lastInjection.current) return;
    lastInjection.current = injection.n;
    setAnnotations({ text: injection.text, items: injection.items });
    if (injection.attachments.length) {
      setAttachments((cur) => [
        ...cur,
        ...injection.attachments.filter((p) => !cur.includes(p)),
      ]);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [injection]);

  const quickPrompts = useQuickPrompts((s) => s.prompts);
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  // 正在填空的快捷指令(带【】的那几条)
  const [filling, setFilling] = useState<QuickPrompt | null>(null);
  // 要二次确认的快捷指令:点了第一下是哪条,3 秒不点第二下自动松开
  const [quickArmed, setQuickArmed] = useArmedConfirm<string>(3000);

  const send = () => {
    const typed = text.trim();
    const body = annotations
      ? [annotations.text, typed].filter(Boolean).join("\n\n")
      : typed;
    if (!body && attachments.length === 0) return;
    onSend(body, attachments);
    setText("");
    setAttachments([]);
    setAnnotations(null);
  };
  const canSend =
    text.trim() !== "" || attachments.length > 0 || annotations !== null;

  const stop = onStop;

  const showStop = working && !canSend;

  // 打 / 选技能(Codex 的技能是 $名字,/ 也能呼出来);Claude 的命令只能放开头
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [cmdIndex, setCmdIndex] = useState(0);
  const cmdQuery = commandQuery(
    text.slice(0, caret),
    agent === "codex" ? ["$", "/"] : ["/"],
    agent === "codex",
  );
  const matches = cmdQuery
    ? matchCommands(commands ?? [], cmdQuery.query).slice(0, 60)
    : [];
  // 打了字还一个都对不上(多半是在写路径)就不弹,空着的菜单挡眼
  const cmdOpen =
    cmdQuery !== null &&
    dismissed !== text &&
    (matches.length > 0 || cmdQuery.query === "" || commands === undefined);
  const activeCmd = Math.min(cmdIndex, Math.max(0, matches.length - 1));
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在菜单弹出的那一下拉
  useEffect(() => {
    if (cmdOpen) onOpenCommands?.();
  }, [cmdOpen]);
  const cmdListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cmdListRef.current
      ?.querySelector(`[data-cmd-index="${activeCmd}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeCmd]);
  const pickCommand = (c: SlashCommandOption) => {
    if (!cmdQuery) return;
    const before = text.slice(0, cmdQuery.start);
    const insert = `${agent === "codex" ? "$" : "/"}${c.name} `;
    const next = before + insert + text.slice(caret).replace(/^ /, "");
    const pos = before.length + insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    // 整条不透明:输入框本身是半透明的灰,底下不能透出任何东西
    <div
      className={cn(
        "relative z-20 shrink-0",
        compact ? "" : "bg-background px-6 pt-1 pb-4",
      )}
    >
      {cmdOpen && (
        <div
          className={cn(
            "absolute inset-x-0 bottom-full z-30 mx-auto max-w-3xl",
            compact ? "px-1 pb-1" : "px-6",
          )}
        >
          <div
            ref={cmdListRef}
            role="listbox"
            aria-label="选择技能"
            className="flex max-h-72 flex-col overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            {matches.length === 0 ? (
              <div className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
                {commands === undefined ? "正在读取技能…" : "没有可用的技能"}
              </div>
            ) : (
              matches.map((c, i) => (
                <button
                  key={c.name}
                  type="button"
                  role="option"
                  aria-selected={i === activeCmd}
                  data-cmd-index={i}
                  // 按下不抢输入框的焦点
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== activeCmd && setCmdIndex(i)}
                  onClick={() => pickCommand(c)}
                  className={cn(
                    "flex w-full cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]",
                    i === activeCmd && "bg-foreground/10",
                  )}
                >
                  <span className="shrink-0 font-medium">
                    {agent === "codex" ? "$" : "/"}
                    {c.name}
                  </span>
                  {c.argumentHint && (
                    <span className="shrink-0 text-muted-foreground/70">
                      {c.argumentHint}
                    </span>
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground"
                    title={c.description}
                  >
                    {c.description}
                  </span>
                  {c.builtin && (
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">
                      命令
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {branch && !compact && (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-2 pb-1.5 text-[12px] text-muted-foreground">
          <button
            type="button"
            title="打开仓库"
            onClick={() => onOpenRepo?.()}
            className="flex min-w-0 items-center gap-1 rounded transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            {branch.worktree && (
              <>
                <span className="shrink-0 text-foreground/80">
                  {branch.worktree}
                </span>
                <span className="shrink-0 text-muted-foreground/50">·</span>
              </>
            )}
            <span className="min-w-0 truncate" title={branch.name}>
              {branch.name}
            </span>
          </button>
          <span className="mr-4 ml-auto flex shrink-0 items-center gap-3 text-[11px]">
            {/* 工作区干净就不占位置,一眼看出有没有要提交的。输入框圆角半径
                24px,文字右缘贴着角会像夹在里面:整组往左让到圆角以内 */}
            {branch.changed > 0 && (
              <button
                type="button"
                title="提交这些改动"
                onClick={() => onOpenRepo?.(true)}
                className="tabular-nums text-amber-500/80 hover:underline"
              >
                {branch.changed} 个文件未提交
              </button>
            )}
          </span>
        </div>
      )}
      <div
        className={cn(
          "mx-auto flex max-w-3xl",
          compact
            ? "flex-row flex-wrap items-center gap-1 px-2 py-1.5"
            : "flex-col gap-2 rounded-[24px] bg-foreground/[0.12] px-4 pt-3.5 pb-2.5",
        )}
      >
        {annotations && (
          <div className={cn("flex", compact && "basis-full px-1 pb-1")}>
            {/* 悬停展开成卡片列表(照 Codex):小图 + 说明 */}
            <span className="group/annot relative flex items-center gap-1.5 rounded-lg bg-foreground/[0.1] py-1 pr-1 pl-2.5 text-[12px]">
              <HugeiconsIcon
                icon={Message01Icon}
                size={13}
                strokeWidth={1.75}
              />
              {annotations.items.length} 条注释
              <button
                type="button"
                aria-label="移除注释"
                onClick={() => setAnnotations(null)}
                className="cursor-pointer rounded px-1 text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
              >
                ×
              </button>
              <div className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden w-72 flex-col gap-1 rounded-xl border border-border bg-popover p-1.5 shadow-xl group-hover/annot:flex">
                {annotations.items.map((it, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: 顺序即身份,说明会重复
                    key={i}
                    className="flex items-center gap-2 rounded-lg px-1 py-1"
                  >
                    {it.thumb ? (
                      <img
                        src={it.thumb}
                        alt=""
                        className="size-9 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded bg-foreground/10 text-[11px]">
                        {i + 1}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {it.note.trim() || "(未写说明)"}
                    </span>
                  </div>
                ))}
              </div>
            </span>
          </div>
        )}
        {attachments.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap items-end gap-1.5",
              compact && "basis-full px-1 pb-1",
            )}
          >
            {attachments.map((f) =>
              isImagePath(f) ? (
                // 图片(粘贴的截图、选的图)照 Codex 显示成小图,右上角 × 取消
                <span key={f} title={f} className="group/att relative">
                  <ImageThumb
                    path={f}
                    className="size-14 rounded-lg border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`移除 ${f.split("/").pop()}`}
                    onClick={() =>
                      setAttachments((cur) => cur.filter((x) => x !== f))
                    }
                    className="absolute -top-1.5 -right-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-border bg-popover text-[11px] leading-none text-muted-foreground shadow hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ) : (
                <span
                  key={f}
                  title={f}
                  className="flex max-w-64 items-center gap-1 rounded-lg bg-foreground/[0.1] py-0.5 pr-1 pl-2 text-[12px]"
                >
                  <span className="truncate">{f.split("/").pop()}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${f.split("/").pop()}`}
                    onClick={() =>
                      setAttachments((cur) => cur.filter((x) => x !== f))
                    }
                    className="cursor-pointer rounded px-1 text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ),
            )}
          </div>
        )}
        <label htmlFor={inputId} className="sr-only">
          给 {agentName} 发消息
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setCmdIndex(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(e) => {
            // 剪贴板里有图(截图)就存成临时文件当附件;同时有文字的(从网页
            // 复制的图文)文字照常粘进去
            const images = Array.from(e.clipboardData.items)
              .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
              .map((i) => i.getAsFile())
              .filter((f): f is File => f !== null);
            if (images.length === 0) return;
            if (!e.clipboardData.types.includes("text/plain")) {
              e.preventDefault();
            }
            void attachPastedImages(images);
          }}
          {...imeProps}
          onKeyDown={(e) => {
            // 输入法选词、把拼音直接上屏时的回车是给输入法的,不是发送
            if (isImeKey(e)) return;
            if (cmdOpen && matches.length > 0) {
              const n = matches.length;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setCmdIndex(
                  (activeCmd + (e.key === "ArrowDown" ? 1 : n - 1)) % n,
                );
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                pickCommand(matches[activeCmd]);
                return;
              }
            }
            if (cmdOpen && e.key === "Escape") {
              e.preventDefault();
              setDismissed(text);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && working && text === "") {
              e.preventDefault();
              stop();
            }
          }}
          placeholder="随心输入"
          spellCheck={false}
          title="回车发送,Shift+回车换行"
          role="combobox"
          aria-expanded={cmdOpen}
          aria-autocomplete="list"
          className={cn(
            "resize-none bg-transparent text-[14px] leading-[21px] outline-none placeholder:text-[#666666]",
            compact
              ? "order-2 min-h-[28px] min-w-0 flex-1 py-1"
              : "min-h-[42px]",
          )}
        />
        {/* 右边的菜单(模型、更多、用量)以这一行为准贴右边弹出,和发送键对齐
            (照 Codex);权限菜单仍跟着自己的按钮 */}
        <div
          className={cn(
            compact ? "contents" : "relative flex items-center gap-1",
          )}
        >
          <button
            type="button"
            title="添加文件或图片(可多选)"
            aria-label="添加附件"
            onClick={() => void pickFiles()}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
              compact && "order-1",
            )}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
          </button>
          {/* 权限模式:照 Codex 左下角那个,完全访问标成橙色 */}
          <div className={cn("relative", compact && "hidden")}>
            <button
              type="button"
              title="权限模式"
              onClick={() => toggleMenu("mode")}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[12.5px] transition-colors hover:bg-foreground/10",
                currentMode?.danger
                  ? "text-orange-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={currentMode?.danger ? AlertCircleIcon : Shield01Icon}
                size={13}
                strokeWidth={1.75}
              />
              {currentMode?.label ?? "权限模式"}
            </button>
            <InlineMenu
              open={menu === "mode"}
              onClose={closeMenu}
              className="w-80 p-1.5"
            >
              <div className="px-2.5 pt-1.5 pb-2 text-[12.5px] text-muted-foreground">
                应如何批准 {agentName} 操作?
              </div>
              {modeOptions.map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.mode === permissionMode}
                  onClick={() => {
                    onSetMode(o.mode);
                    closeMenu();
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-foreground/10",
                    o.danger && "text-orange-400",
                  )}
                >
                  <HugeiconsIcon
                    icon={o.icon}
                    size={15}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[13px] font-medium">{o.title}</span>
                    <span
                      className={cn(
                        "text-[11.5px]",
                        o.danger
                          ? "text-orange-400/85"
                          : "text-muted-foreground",
                      )}
                    >
                      {o.hint}
                    </span>
                  </span>
                  {o.mode === permissionMode && (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={14}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0"
                    />
                  )}
                </button>
              ))}
            </InlineMenu>
          </div>
          <span className={cn("flex-1", compact && "hidden")} />
          {/* 快捷指令:点开选一条,整理好的话直接发出去(Review、修复、同步…,
              能自己加) */}
          {/* 菜单以整行为准往上弹,在输入框中间居中(不跟着按钮偏到一边) */}
          <div className={cn(compact && "hidden")}>
            <button
              type="button"
              title="快捷指令:Review、修复、同步,也能加自己的"
              onClick={() => toggleMenu("quick")}
              className={toolText}
            >
              快捷指令
            </button>
            <InlineMenu
              open={menu === "quick"}
              onClose={closeMenu}
              align="start"
              className="left-1/2 max-h-[70vh] w-[34rem] max-w-full -translate-x-1/2 overflow-y-auto"
            >
              {/* 分组、两列排:十几条竖着一长串太难找 */}
              {/* 两列各自从上往下排(不用 CSS columns:那个第二列会从
                  上一列断开处带着间距起头,两列顶部对不齐) */}
              <div className="grid grid-cols-2 items-start gap-2 p-1">
                {splitQuickColumns(groupQuickPrompts(quickPrompts)).map(
                  (col, ci) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 固定两列
                    <div key={ci} className="flex flex-col gap-2">
                      {col.map(({ group, items }) => (
                        // 每组一块浅底圆角卡片,组和组之间一眼分得开
                        <div
                          key={group}
                          className="rounded-lg bg-foreground/[0.04] p-1"
                        >
                          <div className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[11.5px] font-medium text-foreground/70">
                            <span className="h-3 w-0.5 rounded-full bg-[#4d8ef7]" />
                            {group}
                          </div>
                          {items.map((q) => (
                            <button
                              key={q.id}
                              type="button"
                              role="menuitem"
                              title={q.text}
                              onClick={() => {
                                // 会动到外面的(提交推送、装设备…):第一下只上膛,3 秒内
                                // 再点一次才发
                                if (q.confirm && quickArmed !== q.id) {
                                  setQuickArmed(q.id);
                                  return;
                                }
                                setQuickArmed(null);
                                closeMenu();
                                // 带【姓名】这类空要填的:弹框逐个填、能补充几句,点发送才发;
                                // 其余直接发出去
                                if (quickPromptBlanks(q.text).length > 0) {
                                  setFilling(q);
                                  return;
                                }
                                onSend(q.text, []);
                              }}
                              className={cn(
                                "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1 text-left hover:bg-foreground/10",
                                quickArmed === q.id &&
                                  "bg-amber-500/15 hover:bg-amber-500/20",
                              )}
                            >
                              <span className="flex w-3.5 shrink-0 justify-center pt-0.5 text-muted-foreground">
                                <HugeiconsIcon
                                  icon={
                                    QUICK_PROMPT_ICONS[q.id] ?? Message01Icon
                                  }
                                  size={13}
                                  strokeWidth={1.75}
                                />
                              </span>
                              <span className="flex min-w-0 flex-col">
                                <span className="text-[12.5px]">{q.label}</span>
                                {quickArmed === q.id ? (
                                  <span className="text-[11px] leading-snug text-amber-500">
                                    再点一次确认发送
                                  </span>
                                ) : (
                                  <span className="truncate text-[11px] leading-snug text-muted-foreground">
                                    {q.text.split("\n")[0]}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  ),
                )}
              </div>
              <div className="my-1 border-t border-border/60" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setQuickEditOpen(true);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <span className="flex w-3.5 shrink-0 justify-center">
                  <HugeiconsIcon
                    icon={Settings02Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                </span>
                编辑快捷指令…
              </button>
            </InlineMenu>
          </div>
          {/* 用量、压缩、新会话直接摆出来,不收进"更多"菜单 */}
          <div className={cn(compact && "hidden")}>
            <button
              type="button"
              title="查看用量"
              onClick={() => {
                if (menu !== "usage") onOpenUsage();
                toggleMenu("usage");
              }}
              className={toolText}
            >
              用量
            </button>
            <InlineMenu open={menu === "usage"} onClose={closeMenu} align="end">
              <UsagePanel agentName={agentName} usage={usage} />
            </InlineMenu>
          </div>
          {/* 上下文占用紧挨着"压缩":满了顺手就压 */}
          <span className={cn("flex items-center", compact && "hidden")}>
            <ContextMeter context={context} />
            <button
              type="button"
              title={compacting ? "正在压缩上下文" : "压缩上下文"}
              disabled={compacting}
              onClick={onCompact}
              className={cn(
                toolText,
                context && "pl-1",
                compacting && "cursor-default text-foreground",
              )}
            >
              {compacting ? "压缩中…" : "压缩"}
            </button>
          </span>
          <button
            type="button"
            title="开一个新会话"
            onClick={onNewChat}
            className={cn(toolText, compact && "hidden")}
          >
            新会话
          </button>
          <div className={cn(compact && "hidden")}>
            <button
              type="button"
              title="切换模型"
              onClick={() => {
                if (menu !== "model") onOpenModels();
                toggleMenu("model");
              }}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[12.5px] text-foreground/85 transition-colors hover:bg-foreground/10"
            >
              {modelLabel(model, models, agentName)}
              {(agent === "codex" || agent === "claude") && effort && (
                <span
                  className={
                    effort === "ultra"
                      ? "text-[#b48cf7]"
                      : "text-muted-foreground"
                  }
                >
                  {agent === "claude" ? effort : effortLabel(effort)}
                </span>
              )}
              {agent === "claude" && ultracode && (
                <span className="text-[#b48cf7]">ultracode</span>
              )}
              <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
            </button>
            <InlineMenu
              open={menu === "model"}
              onClose={closeMenu}
              align="end"
              className="min-w-64"
            >
              {agent === "codex" ? (
                <CodexModelPanel
                  model={model}
                  models={models}
                  effort={effort}
                  serviceTier={serviceTier}
                  onSetModel={onSetModel}
                  onSetEffort={(e) => onSetEffort?.(e)}
                  onSetServiceTier={(t) => onSetServiceTier?.(t)}
                />
              ) : agent === "claude" ? (
                <ClaudeModelPanel
                  model={model}
                  models={models}
                  effort={effort}
                  ultracode={ultracode}
                  appliedEffort={appliedEffort}
                  ultracodeAvailable={ultracodeAvailable}
                  onSetModel={onSetModel}
                  onSetEffort={(e) => onSetEffort?.(e)}
                  onSetUltracode={(on) => onSetUltracode?.(on)}
                />
              ) : (
                <>
                  {models.length === 0 ? (
                    <div className="px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
                      正在读取可用模型…
                    </div>
                  ) : (
                    models.map((m) => (
                      <MenuItem
                        key={m.value}
                        active={!!model && findModel(model, models) === m}
                        onClick={() => {
                          onSetModel(m.value);
                          closeMenu();
                        }}
                      >
                        <span className="flex flex-col">
                          <span>{m.displayName}</span>
                          {m.description && (
                            <span className="text-[11px] font-normal text-muted-foreground">
                              {shortDescription(m.description)}
                            </span>
                          )}
                        </span>
                      </MenuItem>
                    ))
                  )}
                </>
              )}
            </InlineMenu>
          </div>
          <button
            type="button"
            aria-label={showStop ? "停止" : "发送"}
            title={showStop ? "停止(Esc)" : "发送(回车)"}
            disabled={!showStop && !canSend}
            onClick={showStop ? stop : send}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-full bg-[#2c67c5] text-white transition-opacity hover:bg-[#3572d4] disabled:cursor-default",
              !showStop && !canSend && "opacity-45",
              compact && "order-3 size-7",
            )}
          >
            <HugeiconsIcon
              icon={showStop ? StopIcon : ArrowUp02Icon}
              size={14}
              strokeWidth={2.25}
            />
          </button>
        </div>
      </div>
      <QuickPromptFillDialog
        prompt={filling}
        onCancel={() => setFilling(null)}
        onSend={(t) => {
          setFilling(null);
          onSend(t, []);
        }}
      />
      <QuickPromptsDialog
        open={quickEditOpen}
        onOpenChange={setQuickEditOpen}
      />
    </div>
  );
}
