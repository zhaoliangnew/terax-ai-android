import { useImeGuard } from "@/lib/ime";
import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  GitBranchIcon,
  Hold02Icon,
  Message01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Shield01Icon,
  StopIcon,
  Task01Icon,
  Tick02Icon,
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
import type { ContextUsage } from "../lib/sdkChat";
import type { UsageInfo } from "../lib/usage";
import { AGENT_NAMES, type ChatAgent } from "../store/chatProviders";
import type { ModelOption } from "../store/claudeChatStore";
import { CodexModelPanel, effortLabel } from "./CodexModelPanel";
import { ImageThumb } from "./ImageLightbox";
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
  onSetServiceTier?: (tier: string) => void;
  /** 套餐用量:打开面板时去查,undefined = 还在查。 */
  usage?: UsageInfo | null;
  /** 当前上下文大小和占比(底栏"用量"前面显示)。 */
  context?: ContextUsage | null;
  /** 输入框上方显示的当前分支;在 worktree 里再带上 worktree 名。 */
  branch?: { name: string; worktree: string | null } | null;
  onOpenUsage: () => void;
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
  "flex h-7 cursor-pointer items-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground";

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
  const hit = models.find(
    (m) => m.value === model || model.startsWith(m.value),
  );
  // 菜单项名字是"Opus (1M context)"这种不带版本的,按钮上用说明里的
  // 具体型号("Opus 5.5 with 1M context" → Opus 5.5 1M)
  if (hit) return modelNameOf(hit) || hit.displayName;
  if (!model.startsWith("claude-")) return model;
  // claude-opus-5-5[1m] → Opus 5.5 1M,和菜单里的写法一样首字母大写
  const name = model
    .replace(/^claude-/, "")
    .replace(/\[1m\]$/, " 1M")
    .replace(/-(\d+)-(\d+)/, " $1.$2");
  return name.charAt(0).toUpperCase() + name.slice(1);
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
  serviceTier = null,
  onSetEffort,
  onSetServiceTier,
  usage,
  branch,
  context,
  onOpenUsage,
}: Props) {
  const agentName = AGENT_NAMES[agent];
  const modeOptions = agent === "codex" ? CODEX_MODES : CLAUDE_MODES;
  const currentMode = modeOptions.find((o) => o.mode === permissionMode);
  const [text, setText] = useState("");
  const { imeProps, isImeKey } = useImeGuard();
  const [menu, setMenu] = useState<"mode" | "model" | "usage" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleMenu = (m: "mode" | "model" | "usage") =>
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

  return (
    // 整条不透明:输入框本身是半透明的灰,底下不能透出任何东西
    <div className="relative z-20 shrink-0 bg-background px-6 pt-1 pb-4">
      {branch && (
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-2 pb-1.5 text-[12px] text-muted-foreground">
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
        </div>
      )}
      <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-[24px] bg-foreground/[0.12] px-4 pt-3.5 pb-2.5">
        {annotations && (
          <div className="flex">
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
          <div className="flex flex-wrap items-end gap-1.5">
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
          onChange={(e) => setText(e.target.value)}
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
          className="min-h-[42px] resize-none bg-transparent text-[14px] leading-[21px] outline-none placeholder:text-[#666666]"
        />
        {/* 右边的菜单(模型、更多、用量)以这一行为准贴右边弹出,和发送键对齐
            (照 Codex);权限菜单仍跟着自己的按钮 */}
        <div className="relative flex items-center gap-1">
          <button
            type="button"
            title="添加文件或图片(可多选)"
            aria-label="添加附件"
            onClick={() => void pickFiles()}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={15} strokeWidth={2} />
          </button>
          {/* 权限模式:照 Codex 左下角那个,完全访问标成橙色 */}
          <div className="relative">
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
          <span className="flex-1" />
          {/* 用量、压缩、新会话直接摆出来,不收进"更多"菜单 */}
          <div>
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
          <span className="flex items-center">
            <ContextMeter context={context} />
            <button
              type="button"
              title="压缩上下文"
              onClick={onCompact}
              className={cn(toolText, context && "pl-1")}
            >
              压缩
            </button>
          </span>
          <button
            type="button"
            title="开一个新会话"
            onClick={onNewChat}
            className={toolText}
          >
            新会话
          </button>
          <div>
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
              {agent === "codex" && effort && (
                <span className="text-muted-foreground">
                  {effortLabel(effort)}
                </span>
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
                  onDone={closeMenu}
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
                        active={
                          m.value === model || !!model?.startsWith(m.value)
                        }
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
    </div>
  );
}
