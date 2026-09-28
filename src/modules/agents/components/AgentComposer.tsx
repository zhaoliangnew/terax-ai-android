import { cn } from "@/lib/utils";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  Hold02Icon,
  MoreHorizontalIcon,
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
import type { UsageInfo } from "../lib/usage";
import type { ModelOption } from "../store/claudeChatStore";
import { CodexModelPanel, effortLabel } from "./CodexModelPanel";
import { ImageThumb } from "./ImageLightbox";
import { UsagePanel } from "./UsagePanel";

type Props = {
  /** 聊天接的是谁:权限菜单的选项、各处的称呼跟着变。 */
  agent: "claude" | "codex";
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
  /** Codex 才有:推理强度、快速档。 */
  effort?: string | null;
  serviceTier?: string | null;
  onSetEffort?: (effort: string) => void;
  onSetServiceTier?: (tier: string) => void;
  /** 套餐用量:打开面板时去查,undefined = 还在查。 */
  usage?: UsageInfo | null;
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

/** 模型菜单还没拉回来时,按 id 给个能读的名字。 */
function modelLabel(
  model: string | null,
  models: ModelOption[],
  fallback: string,
): string {
  if (!model) return fallback;
  const hit = models.find(
    (m) => m.value === model || model.startsWith(m.value),
  );
  if (hit) return hit.displayName;
  return model
    .replace(/^claude-/, "")
    .replace(/\[1m\]$/, " 1M")
    .replace(/-(\d+)-(\d+)/, " $1.$2");
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
  effort = null,
  serviceTier = null,
  onSetEffort,
  onSetServiceTier,
  usage,
  onOpenUsage,
}: Props) {
  const agentName = agent === "codex" ? "Codex" : "Claude";
  const modeOptions = agent === "codex" ? CODEX_MODES : CLAUDE_MODES;
  const currentMode = modeOptions.find((o) => o.mode === permissionMode);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<"mode" | "model" | "more" | "usage" | null>(
    null,
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleMenu = (m: "mode" | "model" | "more") =>
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

  const send = () => {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    onSend(body, attachments);
    setText("");
    setAttachments([]);
  };
  const canSend = text.trim() !== "" || attachments.length > 0;

  const stop = onStop;

  const showStop = working && !canSend;

  return (
    // 整条不透明:输入框本身是半透明的灰,底下不能透出任何东西
    <div className="shrink-0 bg-background px-6 pt-1 pb-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-[24px] bg-foreground/[0.12] px-4 pt-3.5 pb-2.5">
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
          onKeyDown={(e) => {
            // 输入法选词时的回车是确认候选,不是发送
            if (e.nativeEvent.isComposing) return;
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
                              {m.description}
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
          <div>
            <button
              type="button"
              aria-label="更多"
              title="更多"
              onClick={() => toggleMenu("more")}
              className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={15}
                strokeWidth={2}
              />
            </button>
            <InlineMenu
              open={menu === "more"}
              onClose={closeMenu}
              align="end"
              className="min-w-36"
            >
              <MenuItem
                onClick={() => {
                  onOpenUsage();
                  setMenu("usage");
                }}
              >
                用量
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onCompact();
                  closeMenu();
                }}
              >
                压缩上下文
              </MenuItem>
              <div className="my-1 h-px bg-border" />
              <MenuItem
                onClick={() => {
                  onNewChat();
                  closeMenu();
                }}
              >
                新会话
              </MenuItem>
            </InlineMenu>
            <InlineMenu open={menu === "usage"} onClose={closeMenu} align="end">
              <UsagePanel agentName={agentName} usage={usage} />
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
