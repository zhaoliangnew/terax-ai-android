import { MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  ArrowRight01Icon,
  Copy01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ChatItem, chatTurns } from "../lib/chatItems";
import { useSmoothText } from "../lib/useSmoothText";
import type { PermissionAsk } from "../store/claudeChatStore";

type Props = {
  items: ChatItem[];
  agentName: string;
  working: boolean;
  /** 正在启动 / 已结束 / 启动失败时的一行提示;正常对话时为 null。 */
  statusText: string | null;
  /** Claude 等着确认的操作(可能不止一个)。 */
  permissions: PermissionAsk[];
  onPermission: (id: string, allow: boolean, always?: boolean) => void;
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

/** 回复正文:流式输出时逐字放出来,不是一块一块往外蹦。 */
function AssistantText({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const shown = useSmoothText(text, streaming);
  return <MessageResponse>{shown}</MessageResponse>;
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
    </div>
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
        <span className="shrink-0 font-medium">{item.name}</span>
        <span className="min-w-0 truncate text-muted-foreground/80">
          {item.summary}
        </span>
        {item.result?.isError && (
          <span className="shrink-0 text-[11px] text-red-400">失败</span>
        )}
        {!item.result && running && (
          <Shimmer className="shrink-0 text-[11px]">执行中</Shimmer>
        )}
      </button>
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
  items,
  agentName,
  working,
  statusText,
  permissions,
  onPermission,
  onQuote,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => chatTurns(items), [items]);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容变了才需要跟到底
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items, working, permissions, statusText]);

  const lastIndex = items.length - 1;
  const last = items[lastIndex];
  const replying = last?.kind === "assistant" && last.streaming === true;

  return (
    // z-10:压在终端(xterm 的几层画布自带层级)上面,滚轮和点击都归聊天
    <div className="absolute inset-0 z-10 bg-background">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 鼠标只用来读选区、收起工具条,消息本身不可交互 */}
      <div
        ref={scrollRef}
        onWheel={(e) => {
          if (e.deltaY < 0) stickRef.current = false;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
            stickRef.current = true;
          }
          updateActiveTurn(el);
        }}
        onMouseUp={() => setTimeout(readSelection, 0)}
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
              }}
              className="cursor-pointer border-l border-border px-2.5 py-1.5 hover:bg-foreground/10"
            >
              复制
            </button>
          </div>
        )}
        {/* 全局默认不让选字(桌面应用的习惯),聊天内容要能选中复制 */}
        <div className="select-text mx-auto flex max-w-3xl cursor-text flex-col px-6 pt-8 pb-12">
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
                          {item.attachments.map((f) => (
                            <span
                              key={f}
                              title={f}
                              className="max-w-56 truncate rounded-md bg-foreground/[0.08] px-2 py-0.5 text-[11.5px] text-muted-foreground"
                            >
                              {f.split("/").pop()}
                            </span>
                          ))}
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
                  <ToolRow item={item} running={working && i === lastIndex} />
                )}
                {item.kind === "note" && (
                  <div className="text-center text-[11.5px] text-muted-foreground/70">
                    {item.text}
                  </div>
                )}
              </div>
            );
          })}
          {permissions.map((p) => (
            <PermissionCard
              key={p.id}
              ask={p}
              onAnswer={(allow, always) => onPermission(p.id, allow, always)}
            />
          ))}
          {statusText && (
            <div className="mt-6 text-center text-[12px] text-muted-foreground">
              {statusText}
            </div>
          )}
          {/* 回复已经在往外流了就不再挂"正在思考":它在文字下面跟着一跳一跳 */}
          {working && permissions.length === 0 && !replying && (
            <Shimmer className="mt-4 text-[13px]">正在思考</Shimmer>
          )}
        </div>
      </div>
      {turns.length > 1 && (
        <TurnRail turns={turns} active={activeTurn} onJump={jumpTo} />
      )}
    </div>
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
  return (
    <nav
      aria-label="对话导航"
      // group/rail:鼠标一进这一列,所有横线一起拉长(照 Codex)
      className="group/rail absolute top-1/2 left-3 z-20 flex max-h-[70%] -translate-y-1/2 flex-col"
    >
      {turns.map((t) => {
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
    </nav>
  );
}
