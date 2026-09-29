import { rectToVisualScale } from "@/lib/appZoom";
import { useImeGuard } from "@/lib/ime";
import { cn } from "@/lib/utils";
import { sendAnnotation } from "@/modules/agents/lib/sendAnnotation";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Comment01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { recordTitle, recordVisit } from "./lib/recentSites";
import { displayUrl, localHtmlPath, toUrl } from "./lib/url";
import {
  annotationCards,
  annotationPrompt,
  type WebAnnotReport,
} from "./lib/webAnnotations";
import { WebStartPage } from "./WebStartPage";

type Props = {
  /** 原生 webview 的 label,必须以 `web-` 开头(Rust 只认这种)。 */
  tabId: string;
  /** 首次打开的地址;about:blank 表示空白页,等输入网址再真正开。 */
  initialUrl: string;
  visible: boolean;
  /** 页面标题变了,回给上面更新 tab 文字。 */
  onTitle?: (title: string) => void;
};

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * 原生网页会盖住所有 HTML(它是窗口里另一个原生视图)。弹框、下拉菜单这类
 * 浮层只要和网页区域重叠,就先把网页藏起来,不然浮层会被挡在后面。
 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

/** 元素在窗口里的可视坐标:缩放容器里的元素量出来是布局坐标,要乘缩放倍数。 */
function visualRect(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const s = el.closest(".zoom-content") ? rectToVisualScale() : 1;
  return new DOMRect(r.x * s, r.y * s, r.width * s, r.height * s);
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

function coveredByOverlay(area: DOMRect): boolean {
  for (const el of document.querySelectorAll(OVERLAY_SELECTOR)) {
    const r = visualRect(el);
    if (r.width > 0 && r.height > 0 && overlaps(area, r)) return true;
  }
  return false;
}

/**
 * 内嵌浏览器的一个标签页(方案 C):页面是窗口里的原生 webview(macOS 上是
 * WKWebView),渲染、滚动、输入法都是原生的。这里只放一个占位区,把它的
 * 位置和大小实时同步给原生 webview;不可见或被浮层挡住时把 webview 藏起来。
 */
export function WebTab({ tabId, initialUrl, visible, onTitle }: Props) {
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const areaRef = useRef<HTMLDivElement>(null);
  /** 原生 webview 建好了没有(空白页要等第一次输入网址才建)。 */
  const openedRef = useRef(false);
  /** 当前页面地址,给"最近访问"补标题用。 */
  const urlRef = useRef(initialUrl);
  const lastRef = useRef<{ b: Bounds; shown: boolean } | null>(null);
  const [opened, setOpened] = useState(false);
  const [address, setAddress] = useState(displayUrl(initialUrl));
  const [loading, setLoading] = useState(false);
  const { imeProps, isImeKey } = useImeGuard();
  const [error, setError] = useState<string | null>(null);
  // AI 工具正在操作这个页面:显示在工具栏上,停手 3 秒后消失
  const [aiAction, setAiAction] = useState<string | null>(null);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 批注模式:页面里点元素写评论;条数、发送、退出都在页面底部的浮条里
  const [annotating, setAnnotating] = useState(false);

  const measure = (): Bounds | null => {
    const el = areaRef.current;
    if (!el) return null;
    const r = visualRect(el);
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  // 把原生 webview 摆到占位区上;该藏就藏。只在有变化时才发给 Rust
  const sync = () => {
    if (!openedRef.current) return;
    const b = visible ? measure() : null;
    const shown =
      b !== null && !coveredByOverlay(new DOMRect(b.x, b.y, b.width, b.height));
    const last = lastRef.current;
    if (
      last &&
      last.shown === shown &&
      (!b ||
        (last.b.x === b.x &&
          last.b.y === b.y &&
          last.b.width === b.width &&
          last.b.height === b.height))
    ) {
      return;
    }
    if (b) {
      void invoke("web_set_bounds", { label: tabId, ...b }).catch(() => {});
    }
    void invoke("web_set_visible", { label: tabId, visible: shown }).catch(
      () => {},
    );
    lastRef.current = {
      b: b ?? last?.b ?? { x: 0, y: 0, width: 1, height: 1 },
      shown,
    };
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const open = async (url: string) => {
    const b = measure() ?? { x: 0, y: 0, width: 1, height: 1 };
    setError(null);
    setLoading(true);
    // 本地 html 文件(file://…)交给 Rust 走 asset 协议,不当网址
    const file = localHtmlPath(url);
    try {
      await invoke("web_open", { label: tabId, url, file, ...b });
      openedRef.current = true;
      lastRef.current = null;
      setOpened(true);
      syncRef.current();
    } catch (e) {
      setLoading(false);
      setError(String(e));
    }
  };

  // 页面加载、标题变化:Rust 那边按 label 广播,这里只收自己的
  useEffect(() => {
    const offs: (() => void)[] = [];
    let alive = true;
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (alive ? offs.push(u) : u())).catch(() => {});
    keep(
      listen<{ label: string; url: string; loading: boolean }>(
        "web://load",
        (e) => {
          if (e.payload.label !== tabId) return;
          setLoading(e.payload.loading);
          if (!e.payload.loading) {
            urlRef.current = e.payload.url;
            setAddress(displayUrl(e.payload.url));
            recordVisit(e.payload.url);
          }
        },
      ),
    );
    keep(
      listen<{ label: string; title: string }>("web://title", (e) => {
        if (e.payload.label === tabId && e.payload.title) {
          onTitleRef.current?.(e.payload.title);
          recordTitle(urlRef.current, e.payload.title);
        }
      }),
    );
    keep(
      listen<{ label: string; action: string }>("web://ai-activity", (e) => {
        if (e.payload.label !== tabId) return;
        setAiAction(e.payload.action);
        if (aiTimer.current) clearTimeout(aiTimer.current);
        aiTimer.current = setTimeout(() => setAiAction(null), 3000);
      }),
    );
    keep(
      listen<WebAnnotReport>("web://annotations", (e) => {
        if (e.payload.label !== tabId) return;
        if (e.payload.kind === "exit") {
          setAnnotateRef.current(false);
          return;
        }
        if (e.payload.kind === "send") sendRef.current(e.payload);
      }),
    );
    return () => {
      alive = false;
      for (const off of offs) off();
      if (aiTimer.current) clearTimeout(aiTimer.current);
    };
  }, [tabId]);

  // 首次:给了真网址就直接开;关 tab 时把原生 webview 一起关掉
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在 tab 创建时开一次
  useEffect(() => {
    if (initialUrl !== "about:blank") void open(initialUrl);
    return () => {
      openedRef.current = false;
      void invoke("web_close", { label: tabId }).catch(() => {});
    };
  }, [tabId]);

  // 位置跟着占位区走:尺寸变化靠 ResizeObserver,纯位移(旁边面板拖动)和
  // 浮层开合靠轮询兜底 —— 都只在真变了才通知 Rust
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync 走 ref,拿最新的
  useEffect(() => {
    const el = areaRef.current;
    lastRef.current = null;
    syncRef.current();
    if (!el) return;
    const ro = new ResizeObserver(() => syncRef.current());
    ro.observe(el);
    const onResize = () => syncRef.current();
    window.addEventListener("resize", onResize);
    const timer = setInterval(() => syncRef.current(), 200);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      clearInterval(timer);
    };
  }, [visible, opened]);

  const setAnnotate = (on: boolean) => {
    if (!openedRef.current) return;
    setAnnotating(on);
    void invoke("web_annotate", { label: tabId, on }).catch((e) =>
      toast.error(`批注开不了:${String(e)}`),
    );
  };

  const setAnnotateRef = useRef(setAnnotate);
  setAnnotateRef.current = setAnnotate;

  // 发到当前聊天窗格:挂成输入框上方的"N 条注释",发出后退出批注
  const send = (report: WebAnnotReport | null) => {
    if (!report || report.items.length === 0) {
      toast.error("先在页面上点一个元素,写句评论");
      return;
    }
    const where = sendAnnotation(
      annotationPrompt(report),
      [],
      annotationCards(report.items),
    );
    if (!where) {
      toast.error("先在左边的窗格切到聊天或命令行,再发批注");
      return;
    }
    void invoke("web_annotate_edit", { label: tabId, action: "clear" })
      .catch(() => {})
      .finally(() => setAnnotate(false));
    toast.success(
      where === "chat"
        ? `${report.items.length} 条批注已加到对话`
        : `${report.items.length} 条批注已贴到命令行,确认后回车发送`,
    );
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const go = () => {
    // 地址栏里也能直接打本地 html 的路径
    const file = localHtmlPath(address);
    if (file) {
      if (!openedRef.current) void open(`file://${file}`);
      else
        void invoke("web_navigate_file", { label: tabId, path: file }).catch(
          (e) => setError(String(e)),
        );
      return;
    }
    const url = toUrl(address);
    if (url === "about:blank") return;
    if (!openedRef.current) {
      void open(url);
      return;
    }
    setError(null);
    void invoke("web_navigate", { label: tabId, url }).catch((e) =>
      setError(String(e)),
    );
  };
  const history = (action: "back" | "forward" | "reload") => {
    if (!openedRef.current) return;
    void invoke("web_history", { label: tabId, action }).catch(() => {});
  };

  const iconBtn =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-background",
        !visible && "hidden",
      )}
    >
      {/* 地址栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => history("back")}
          disabled={!opened}
          className={iconBtn}
          title="后退"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => history("forward")}
          disabled={!opened}
          className={iconBtn}
          title="前进"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => history("reload")}
          disabled={!opened}
          className={iconBtn}
          title="刷新"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            size={14}
            strokeWidth={1.75}
            className={cn(loading && "animate-spin")}
          />
        </button>
        {/* 批注开关:照 Codex 放在刷新后面,开着是蓝色。批注中的条数、发送、
            退出都在页面底部的浮条里(画在网页里,原生网页会盖住我们的界面) */}
        <button
          type="button"
          onClick={() => setAnnotate(!annotating)}
          disabled={!opened}
          title={
            annotating ? "退出批注" : "在页面上点元素写评论,发给聊天里的 AI"
          }
          className={cn(
            "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors disabled:cursor-default disabled:opacity-40",
            annotating
              ? "bg-[#2c67c5] text-white"
              : "bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={Comment01Icon} size={13} strokeWidth={1.75} />
          批注
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          {...imeProps}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              go();
              (e.target as HTMLInputElement).blur();
            }
          }}
          // 点进来就全选:直接打新网址,不用先删旧的
          onFocus={(e) => e.currentTarget.select()}
          // biome-ignore lint/a11y/noAutofocus: 新开的空白页直接打网址
          autoFocus={!opened}
          placeholder="搜索或输入网址"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-full bg-foreground/[0.06] px-3 py-1 text-[12.5px] outline-none focus:bg-foreground/[0.1]"
        />
        {aiAction && (
          <span
            title="AI 工具正在操作这个页面"
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#2c67c5]/15 px-2.5 py-1 text-[12px] text-[#6f9ce8]"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[#4d8ef7]" />
            AI 正在操作 · {aiAction}
          </span>
        )}
      </div>
      {/* 原生 webview 就摆在这一块上面;没开之前显示空白页提示 */}
      <div ref={areaRef} className="relative min-h-0 flex-1">
        {!opened && (
          <WebStartPage onOpen={(url) => void open(url)} error={error} />
        )}
      </div>
    </div>
  );
}
