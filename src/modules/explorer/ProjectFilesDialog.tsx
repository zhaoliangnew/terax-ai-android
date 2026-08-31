import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ViewToggle } from "@/components/ViewToggle";
import { cn, isHtmlPath, isMarkdownPath } from "@/lib/utils";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor";
import {
  findSymbol,
  type SymbolHit,
  type SymbolMode,
} from "@/modules/editor/lib/symbolJump";
import {
  detectBinary,
  redetectBinary,
  serverForLanguage,
  useLspRuntimeStore,
} from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type SymbolJumpStrategy,
  setLspActivation,
  setSymbolJumpStrategy,
} from "@/modules/settings/store";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import {
  Cancel01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FileExplorer } from "./FileExplorer";
import { copyToClipboard } from "./lib/contextActions";

// 编辑器整包(CodeMirror + LSP)只在真正打开弹框看文件时才拉进来。
const EditorPane = lazy(() =>
  import("@/modules/editor/EditorPane").then((m) => ({
    default: m.EditorPane,
  })),
);

// 渲染视图同理:markdown 那套解析器不比编辑器轻,不看就不拉。
const MarkdownPreviewPane = lazy(() =>
  import("@/modules/markdown/MarkdownPreviewPane").then((m) => ({
    default: m.MarkdownPreviewPane,
  })),
);
const HtmlPreviewPane = lazy(() =>
  import("@/modules/html-preview/HtmlPreviewPane").then((m) => ({
    default: m.HtmlPreviewPane,
  })),
);

/** 一个工程在这个弹框里开着的文件。 */
export type ProjectFilesState = {
  /** 按打开顺序,同一个文件只出现一次。 */
  tabs: string[];
  active: string | null;
};

/** 没开过任何文件时的空状态。常量复用,免得每次渲染都换一个新对象。 */
export const EMPTY_PROJECT_FILES: ProjectFilesState = {
  tabs: [],
  active: null,
};

/** 快捷键前缀:mac 上是 ⌘,其它平台是 Ctrl。 */
const MOD_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

/** 弹框最小尺寸:再小左树和右边的编辑区就都没法看了。 */
const MIN_DIALOG_W = 720;
const MIN_DIALOG_H = 420;

/**
 * 右下角拖着改弹框大小。
 *
 * 框是 `top-1/2 left-1/2 -translate-1/2` 居中定位的 —— 右下角要跟住手指,
 * 宽高得长两倍的位移量(一半长在左上、一半长在右下)。
 */
function ResizeGrip({
  onResize,
}: {
  onResize: (w: number, h: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label="拖动改变弹框大小"
      className="absolute right-1 bottom-1 z-20 size-3.5 cursor-nwse-resize rounded-br border-r-2 border-b-2 border-border/70 transition-colors hover:border-foreground/60"
      onPointerDown={(e) => {
        const box = e.currentTarget.closest<HTMLElement>(
          '[data-slot="dialog-content"]',
        );
        if (!box) return;
        e.preventDefault();
        const grip = e.currentTarget;
        const rect = box.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        grip.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) =>
          onResize(
            Math.min(
              window.innerWidth - 16,
              Math.max(MIN_DIALOG_W, rect.width + (ev.clientX - startX) * 2),
            ),
            Math.min(
              window.innerHeight - 16,
              Math.max(MIN_DIALOG_H, rect.height + (ev.clientY - startY) * 2),
            ),
          );
        const stop = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", stop);
          grip.removeEventListener("pointercancel", stop);
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
      }}
    />
  );
}

/** 文件名(Windows 上路径是反斜杠,两种分隔符都得认)。 */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 相对工程根的路径,给标题和 tooltip 用。 */
function relTo(root: string | null, path: string): string {
  return root && path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 工程根目录;null 时不渲染。 */
  rootPath: string | null;
  gitStatus?: GitStatusSnapshot | null;
  dirtyPaths?: Set<string>;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onOpenNewTerminal?: (path: string) => void;
  onOpenInSourceControl?: (path: string) => void;
  onOpenGitHistory?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  pathDropTarget?: TerminalPathDropTarget;
  /** 把一条命令丢进当前终端跑(装语言服务器时用,进度直接看终端输出)。 */
  onRunCommand?: (command: string) => void;
  /** 这个工程开着哪些文件、当前是哪个(由外面按工程根存)。 */
  state: ProjectFilesState;
  onStateChange: (next: ProjectFilesState) => void;
};

/**
 * 产品目录文件:工程自己的文件树 + 右边直接看文件。
 *
 * 以前这棵树是钉在侧栏右半边的,和左边的项目树挤在一起 —— 工程一深
 * (src/main/java/net/xnzn/…)就只剩一条窄缝在看代码。改成单独弹框:
 * 左树右文,文件点开**不进顶部 tab** —— 在这儿翻代码是"看一眼"的事,
 * 每看一个文件都往 tab 栏塞一条,tab 栏很快就没法用了。
 */
export function ProjectFilesDialog({
  open,
  onOpenChange,
  rootPath,
  gitStatus,
  dirtyPaths,
  onPathRenamed,
  onPathDeleted,
  onRevealInTerminal,
  onOpenNewTerminal,
  onOpenInSourceControl,
  onOpenGitHistory,
  onAttachToAgent,
  pathDropTarget,
  onRunCommand,
  state,
  onStateChange,
}: Props) {
  // 开着的文件按打开顺序排;同一个文件只占一个 tab,再点一次只是切过去。
  // 状态由外面按工程根存着 —— 关掉弹框、切到别的工程再回来,还是原来那几个
  // 文件;工程的终端 tab 关了才跟着一起没。
  const { tabs, active } = state;
  const apply = (nextTabs: string[], nextActive: string | null) =>
    onStateChange({ tabs: nextTabs, active: nextActive });

  const openFile = (path: string) =>
    apply(tabs.includes(path) ? tabs : [...tabs, path], path);

  /** 只留下 next 这些 tab;当前那个被关掉了就落到 fallback。 */
  const keepOnly = (next: string[], fallback: string | null) =>
    apply(next, active && next.includes(active) ? active : fallback);

  const closeTab = (path: string) => {
    const i = tabs.indexOf(path);
    if (i < 0) return;
    const next = tabs.filter((p) => p !== path);
    // 关掉的正是当前这个:接管右边那个,没有就往左退一个
    apply(next, active === path ? (next[i] ?? next[i - 1] ?? null) : active);
  };

  /**
   * 跳到定义:每个开着的编辑器留一个 handle,跳过去之后要 gotoLine。
   *
   * 目标文件可能还没打开 —— 那就先记在 pendingGoto 里,等它的 EditorPane
   * 挂上来(ref 回调)再滚过去。
   */
  const handles = useRef(new Map<string, EditorPaneHandle>());
  const handleCbs = useRef(
    new Map<string, (h: EditorPaneHandle | null) => void>(),
  );
  const pendingGoto = useRef<{ path: string; line: number } | null>(null);
  /**
   * 把等着的"跳到某一行"派下去。
   *
   * 补一次延时重放:新开的文件是异步读的,编辑器挂上来的那一刻文档可能还没
   * ready,那一次 gotoLine 会落空 —— 结果就是"文件开了,行没到"。再补一次
   * 是幂等的(无非重新居中一下)。
   */
  const flushPendingGoto = () => {
    const pending = pendingGoto.current;
    if (!pending) return;
    const handle = handles.current.get(pending.path);
    if (!handle) return;
    pendingGoto.current = null;
    handle.gotoLine(pending.line, { focus: true });
    window.setTimeout(() => {
      handles.current.get(pending.path)?.gotoLine(pending.line, {
        focus: true,
      });
    }, 250);
  };

  const handleRefFor = (path: string) => {
    let cb = handleCbs.current.get(path);
    if (!cb) {
      cb = (h: EditorPaneHandle | null) => {
        if (!h) {
          handles.current.delete(path);
          return;
        }
        handles.current.set(path, h);
        flushPendingGoto();
      };
      handleCbs.current.set(path, cb);
    }
    return cb;
  };

  // 编辑器挂载的时机和 ref 回调的时机哪个先都可能,渲染后再兜一次
  useEffect(flushPendingGoto);

  const goTo = (path: string, line: number) => {
    pendingGoto.current = { path, line };
    // 跳行只有编辑器接得住,渲染视图里没有"第几行"这回事。
    if (hasRenderedView(path)) setView(path, "raw");
    openFile(path);
    flushPendingGoto();
  };

  // 命中多于一条时摆出来让人挑;`query` 是被搜的那个名字
  const [picker, setPicker] = useState<{
    query: string;
    mode: SymbolMode;
    hits: SymbolHit[];
    truncated: boolean;
  } | null>(null);
  const [, setSearching] = useState(false);
  // 浮层贴着刚才点的位置弹(键盘触发时没有坐标,就摆在编辑区左上)
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  // 连按两下 Shift 打开的"找类/函数"浮层(照 AS 的 Search Everywhere)
  const [everywhere, setEverywhere] = useState<{
    query: string;
    hits: SymbolHit[];
    loading: boolean;
  } | null>(null);
  const everywhereInputRef = useRef<HTMLInputElement>(null);
  // 右键那一刻编辑器里选中的文本(菜单项按它来禁用/生效)
  const [selection, setSelection] = useState("");
  // 文件内查找(⌘F):关键字 + "第几个 / 共几个"
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findStatus, setFindStatus] = useState({ index: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);

  const activeHandle = () => (active ? handles.current.get(active) : undefined);

  /**
   * Markdown / html 默认渲染,这里记的是被手动翻回源码的那几个。不进
   * `ProjectFilesState` —— 视图模式是"这一眼想怎么看",不该跨会话粘住。
   */
  const [rawPaths, setRawPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // null = 跟着默认的"铺满屏幕";拖过右下角之后才记具体像素。
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [unsavedPaths, setUnsavedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const hasRenderedView = (path: string) =>
    isMarkdownPath(path) || isHtmlPath(path);
  const isPreviewing = (path: string) =>
    hasRenderedView(path) && !rawPaths.has(path);
  const setView = (path: string, mode: "rendered" | "raw") =>
    setRawPaths((curr) => {
      const next = new Set(curr);
      if (mode === "raw") next.add(path);
      else next.delete(path);
      return next;
    });
  // 存盘前预览读的还是磁盘上那份,所以有改动时把"渲染"按钮禁掉。主窗口那边
  // 改了没存也算 —— dirtyPaths 是它传进来的。
  const setDirty = (path: string, dirty: boolean) =>
    setUnsavedPaths((curr) => {
      if (curr.has(path) === dirty) return curr;
      const next = new Set(curr);
      if (dirty) next.add(path);
      else next.delete(path);
      return next;
    });
  const isUnsaved = (path: string) =>
    unsavedPaths.has(path) || (dirtyPaths?.has(path) ?? false);

  const runFind = (q: string, step?: "next" | "prev") => {
    const handle = activeHandle();
    if (!handle) return;
    handle.setQuery(q);
    if (step === "next") handle.findNext();
    if (step === "prev") handle.findPrevious();
    setFindStatus(handle.searchStatus(q));
  };
  const jumpStrategy = usePreferencesStore((st) => st.symbolJumpStrategy);

  /**
   * 当前文件这门语言的语言服务器状态。
   *
   * 装没装、装哪儿了,在这条上直接看得见;点"安装"是把命令丢进当前终端跑 ——
   * brew 自己会打进度条,比我再造一个进度条实在。
   */
  const lspActivation = usePreferencesStore((st) => st.lspActivation);
  const lspCustomServers = usePreferencesStore((st) => st.lspCustomServers);
  const activeExt = active?.split(".").pop()?.toLowerCase() ?? null;
  const preset = activeExt
    ? serverForLanguage(activeExt, lspCustomServers, lspActivation)
    : null;
  const presetCommand = preset?.command;
  const detected = useLspRuntimeStore((st) =>
    presetCommand ? st.detected[presetCommand] : undefined,
  );
  useEffect(() => {
    if (presetCommand) void detectBinary(presetCommand);
  }, [presetCommand]);
  const lspEnabled = preset ? lspActivation[preset.id] === "enabled" : false;

  const jumpTo = async (rawName: string, mode: SymbolMode = "definition") => {
    const symbol = rawName.trim();
    if (!rootPath || !symbol) return;
    setSearching(true);
    try {
      const { hits, truncated } = await findSymbol(rootPath, symbol, mode);
      const what = mode === "definition" ? "定义" : "调用";
      if (hits.length === 0) {
        toast.info(`没找到「${symbol}」的${what}`);
        return;
      }
      // 找定义且只有一处:直接跳过去。找调用永远列出来 —— 一处也得看清是谁
      if (mode === "definition" && hits.length === 1 && hits[0]) {
        setPicker(null);
        goTo(hits[0].path, hits[0].line);
        return;
      }
      setAnchor(pointerRef.current);
      setPicker({ query: symbol, mode, hits, truncated });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSearching(false);
    }
  };

  // 连按两下 Shift:400ms 内两次、中间没按别的键才算(按住不放会一直重复,
  // 用 e.repeat 挡掉)
  useEffect(() => {
    if (!open) return;
    let lastShift = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || e.repeat) {
        lastShift = 0;
        return;
      }
      const now = performance.now();
      if (now - lastShift < 400) {
        lastShift = 0;
        setEverywhere({ query: "", hits: [], loading: false });
        // 挂载稍晚,编辑器还可能把焦点抢回去 —— 补几次
        for (const delay of [0, 50, 150]) {
          window.setTimeout(() => {
            const el = everywhereInputRef.current;
            if (el && document.activeElement !== el) el.focus();
          }, delay);
        }
      } else {
        lastShift = now;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // 边打边找(前缀匹配),给 250ms 防抖
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在关键字变了时重查
  useEffect(() => {
    const q = everywhere?.query.trim() ?? "";
    if (!rootPath || q.length < 2) return;
    const timer = window.setTimeout(() => {
      setEverywhere((cur) => (cur ? { ...cur, loading: true } : cur));
      void findSymbol(rootPath, q, "definition", {
        prefix: true,
        maxResults: 60,
      })
        .then(({ hits }) =>
          setEverywhere((cur) =>
            cur && cur.query.trim() === q
              ? { ...cur, hits, loading: false }
              : cur,
          ),
        )
        .catch(() =>
          setEverywhere((cur) => (cur ? { ...cur, loading: false } : cur)),
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [everywhere?.query, rootPath]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "f" || !(e.metaKey || e.ctrlKey)) return;
      // 全局那个 ⌘F 是搜整个工作区的,弹框开着的时候应该是"在这个文件里找"
      e.preventDefault();
      e.stopPropagation();
      setFindOpen(true);
      const sel = activeHandle()?.getSelection()?.trim();
      if (sel) {
        setFindQuery(sel);
        runFind(sel);
      }
      requestAnimationFrame(() => findInputRef.current?.select());
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  /**
   * Esc 一层一层往外退:搜索浮层 → 结果浮层 → 查找条,退完为止,不关大弹框。
   *
   * 统一在 window 捕获阶段拦下所有 Esc:不拦的话关小浮层那一下会顺着传到
   * Radix,把大弹框一起收掉。
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (everywhere) setEverywhere(null);
      else if (picker) setPicker(null);
      else if (findOpen) {
        setFindOpen(false);
        activeHandle()?.clearQuery();
      }
      // 什么都没开着就什么都不做:大弹框只能点右上角的 × 关。翻代码的时候
      // Esc 按得太随手了,一下把整个弹框收掉、开着的几个文件全没,太亏。
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const explorerProps: Partial<ComponentProps<typeof FileExplorer>> = {
    gitStatus,
    dirtyPaths,
    onPathRenamed,
    onPathDeleted,
    onRevealInTerminal,
    onOpenNewTerminal,
    onOpenInSourceControl,
    onOpenGitHistory,
    onAttachToAgent,
    pathDropTarget,
  };

  const name = rootPath?.split("/").pop() ?? "";

  return (
    <Dialog open={open && !!rootPath} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // 树里的重命名输入框、右键菜单都在 portal 里,自动聚焦会把焦点抢走
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Radix 默认 Esc 关框,这儿不要(理由见上面那段 Esc 的处理)
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => {
          pointerRef.current = { x: e.clientX, y: e.clientY };
        }}
        // 默认接近铺满,但四周留一圈 —— 顶到边会盖住应用自己的标题栏,两条
        // 标题叠在一起分不清哪个是哪个。右下角能拖着改。
        style={size ? { width: size.w, height: size.h } : undefined}
        className="flex h-[88vh] w-[92vw] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground/70"
          />
          <DialogTitle className="shrink-0 text-[12.5px] font-semibold">
            {name}
          </DialogTitle>
          {active && (
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
              title={active}
            >
              {relTo(rootPath, active)}
            </span>
          )}
          {/* 跳转用哪套:设置在这儿改就行,不用专门开设置窗口。
              自动 = 这个文件有语言服务器在跑就用它,没有就退回内置搜索。
              语言服务器的安装/检测状态在 设置 → Language servers 里。 */}
          <select
            value={jumpStrategy}
            onChange={(e) =>
              void setSymbolJumpStrategy(e.target.value as SymbolJumpStrategy)
            }
            title="⌘点击/F12 跳转用哪套:自动 / 只用语言服务器 / 只用内置搜索"
            className="ml-auto h-6 shrink-0 cursor-pointer rounded border border-input bg-transparent px-1 text-[11px] outline-none"
          >
            <option value="auto">跳转:自动</option>
            <option value="lsp">跳转:语言服务器</option>
            <option value="search">跳转:内置搜索</option>
          </select>
          {/* 关闭放在标题行右端,跟弹框自带那个大号 X 比更贴这条窄头部 */}
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={() => onOpenChange(false)}
            className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 w-[22rem] shrink-0 flex-col border-r border-border/60">
            <FileExplorer
              rootPath={rootPath}
              activeFilePath={active}
              onOpenFile={openFile}
              {...explorerProps}
            />
          </div>
          {/* zoom-content 必须包着编辑器:EditorPane 自带 .zoom-exempt
              (zoom: 1/--app-zoom),在主界面里它抵消的是外层 .zoom-content。
              弹框是 portal 到 body 的,外面没人给它缩放,那个 1/zoom 就白白
              留下 —— 界面缩放不是 100% 时(这儿是 95%),CodeMirror 量出来的
              坐标和鼠标坐标差一个倍数,点哪儿光标都落偏。 */}
          <div className="terax-jump-caret zoom-content flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            {tabs.length > 0 && (
              <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-1.5 py-1">
                {tabs.map((path, i) => (
                  <ContextMenu key={path}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          "group flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11.5px] transition-colors",
                          path === active
                            ? "bg-foreground/10 text-foreground"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                        )}
                      >
                        <button
                          type="button"
                          title={relTo(rootPath, path)}
                          onClick={() => apply(tabs, path)}
                          className="max-w-40 cursor-pointer truncate"
                        >
                          {path.split("/").pop()}
                        </button>
                        <button
                          type="button"
                          aria-label="关闭"
                          onClick={() => closeTab(path)}
                          className={cn(
                            "cursor-pointer rounded px-0.5 leading-none opacity-0 transition-opacity hover:bg-foreground/15 group-hover:opacity-70 hover:!opacity-100",
                            path === active && "opacity-70",
                          )}
                        >
                          ×
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-40">
                      <ContextMenuItem
                        className="text-[12px]"
                        onSelect={() => closeTab(path)}
                      >
                        关闭
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-[12px]"
                        disabled={tabs.length < 2}
                        onSelect={() => keepOnly([path], path)}
                      >
                        关闭其他
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-[12px]"
                        disabled={i === tabs.length - 1}
                        onSelect={() => keepOnly(tabs.slice(0, i + 1), path)}
                      >
                        关闭右侧
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-[12px]"
                        disabled={i === 0}
                        onSelect={() => keepOnly(tabs.slice(i), path)}
                      >
                        关闭左侧
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-[12px]"
                        onSelect={() => keepOnly([], null)}
                      >
                        全部关闭
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            )}
            {/* 文件内查找:⌘F 打开。AS 那条的极简版 —— 关键字、第几个/共几个、
                上一个/下一个。真正的搜索还是 CodeMirror 自己那套 */}
            {findOpen && (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={12}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground/70"
                />
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(e) => {
                    setFindQuery(e.target.value);
                    runFind(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      runFind(findQuery, e.shiftKey ? "prev" : "next");
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setFindOpen(false);
                      activeHandle()?.clearQuery();
                      activeHandle()?.focus();
                    }
                  }}
                  placeholder="在这个文件里查找…"
                  spellCheck={false}
                  className="h-6 min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                />
                <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                  {findQuery
                    ? findStatus.total
                      ? `${findStatus.index}/${findStatus.total}`
                      : "无匹配"
                    : ""}
                </span>
                <button
                  type="button"
                  aria-label="上一个"
                  title="上一个(⇧回车)"
                  onClick={() => runFind(findQuery, "prev")}
                  className="shrink-0 cursor-pointer rounded px-1 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下一个"
                  title="下一个(回车)"
                  onClick={() => runFind(findQuery, "next")}
                  className="shrink-0 cursor-pointer rounded px-1 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="关闭查找"
                  onClick={() => {
                    setFindOpen(false);
                    activeHandle()?.clearQuery();
                  }}
                  className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={11}
                    strokeWidth={2}
                  />
                </button>
              </div>
            )}
            {/* 语言服务器状态条:只在"跳转"打算用 LSP 的时候才有意义 */}
            {jumpStrategy !== "search" && active && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2.5 py-1 text-[10.5px] text-muted-foreground">
                {!preset ? (
                  <span>.{activeExt} 没有预置语言服务器 —— 跳转走内置搜索</span>
                ) : (
                  <>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        detected && lspEnabled
                          ? "bg-emerald-500"
                          : detected
                            ? "bg-amber-500"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="min-w-0 truncate">
                      {preset.name} · {preset.command} ·{" "}
                      {detected === undefined
                        ? "检测中…"
                        : detected
                          ? lspEnabled
                            ? "已就绪"
                            : "已安装,未启用"
                          : "未安装"}
                    </span>
                    {detected && !lspEnabled && (
                      <button
                        type="button"
                        onClick={() =>
                          void setLspActivation(preset.id, "enabled")
                        }
                        className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 hover:bg-foreground/10 hover:text-foreground"
                      >
                        启用
                      </button>
                    )}
                    {!detected && preset.install && onRunCommand && (
                      <button
                        type="button"
                        title={`在当前终端里跑:${preset.install.command}`}
                        onClick={() => {
                          const cmd = preset.install?.command;
                          if (!cmd) return;
                          // 关掉弹框才看得见终端里的安装进度
                          onOpenChange(false);
                          onRunCommand(cmd);
                        }}
                        className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 hover:bg-foreground/10 hover:text-foreground"
                      >
                        在终端里安装
                      </button>
                    )}
                    <span className="ml-auto shrink-0 text-muted-foreground/70">
                      {MOD_LABEL}点击=调用 · {MOD_LABEL}⇧点击=定义
                    </span>
                    {presetCommand && (
                      <button
                        type="button"
                        onClick={() => void redetectBinary(presetCommand)}
                        className="shrink-0 cursor-pointer rounded border border-border px-1.5 py-0.5 hover:bg-foreground/10 hover:text-foreground"
                      >
                        重新检测
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {/* 每个开着的文件各留一个 EditorPane 挂着,切 tab 只是显隐 ——
                卸载会把没保存的改动和滚动位置一起丢掉 */}
            {/* 编辑器里右键:Tauri 里没有原生菜单,复制/查找都得自己给 */}
            <ContextMenu
              onOpenChange={(isOpen) => {
                if (!isOpen) return;
                setSelection(activeHandle()?.getSelection()?.trim() ?? "");
              }}
            >
              <ContextMenuTrigger asChild>
                <div className="relative min-h-0 flex-1">
                  {tabs.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                      左边选一个文件
                    </div>
                  ) : (
                    tabs.map((path) => (
                      <div
                        key={path}
                        aria-hidden={path !== active}
                        className={cn(
                          "absolute inset-0",
                          path !== active && "invisible pointer-events-none",
                        )}
                      >
                        <Suspense
                          fallback={
                            <div className="flex h-full items-center justify-center">
                              <Spinner className="size-4" />
                            </div>
                          }
                        >
                          <div className="relative h-full">
                            {/* 编辑器始终挂着,预览只是盖在上面 —— 卸载它会
                                把没保存的改动和滚动位置一起丢掉 */}
                            <div
                              className={cn(
                                "absolute inset-0",
                                isPreviewing(path) &&
                                  "invisible pointer-events-none",
                              )}
                            >
                              {hasRenderedView(path) && (
                                <ViewToggle
                                  mode="raw"
                                  onChange={(mode) => setView(path, mode)}
                                  renderedDisabled={isUnsaved(path)}
                                  renderedHint="保存后才能预览"
                                />
                              )}
                              <EditorPane
                                ref={handleRefFor(path)}
                                path={path}
                                onDirtyChange={(dirty) => setDirty(path, dirty)}
                                onJumpToSymbol={(word, mode) =>
                                  void jumpTo(word, mode)
                                }
                              />
                            </div>
                            {/* 弹框外面没有 .zoom-content,这一层是补给
                                EditorPane 的 .zoom-exempt 抵消用的;预览没有
                                那层,得自己再抵消回 100% */}
                            {isPreviewing(path) && (
                              <div className="zoom-exempt absolute inset-0">
                                {isMarkdownPath(path) ? (
                                  <MarkdownPreviewPane
                                    path={path}
                                    visible={path === active}
                                    onSetView={(mode) => setView(path, mode)}
                                  />
                                ) : (
                                  <HtmlPreviewPane
                                    path={path}
                                    visible={path === active}
                                    onSetView={(mode) => setView(path, mode)}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </Suspense>
                      </div>
                    ))
                  )}
                  {/* 结果浮层:贴着刚点的位置弹,只有标题和列表两块;点外面
                  或 Esc 关掉 —— 它是"看一眼就走"的东西,不该占着编辑区。
                  必须 portal 到 body:弹框自己带 translate、编辑区那层还带
                  CSS zoom,两个都会成为 fixed 的包含块,直接写在里面的话
                  `fixed` 会以它们为基准,按视口坐标定位就飞到框外看不见了。
                  body 上是 Radix 的 modal 关掉了 pointer-events,所以这两块
                  要自己写回 auto。 */}
                  {picker &&
                    createPortal(
                      <>
                        {/* 点外面关掉的挡板。做成 button 免掉一堆 a11y 抑制注释 */}
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label="关闭结果"
                          className="pointer-events-auto fixed inset-0 z-[55] cursor-default"
                          onClick={() => setPicker(null)}
                        />
                        <div
                          className="pointer-events-auto fixed z-[60] flex max-h-[24rem] w-[44rem] max-w-[calc(100vw-4rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
                          style={{
                            // 贴着光标,但不能被窗口边缘切掉;没有坐标(键盘触发)就摆中间
                            left: anchor
                              ? Math.max(
                                  16,
                                  Math.min(anchor.x, window.innerWidth - 720),
                                )
                              : "50%",
                            top: anchor
                              ? Math.max(
                                  16,
                                  Math.min(
                                    anchor.y + 12,
                                    window.innerHeight - 400,
                                  ),
                                )
                              : "20%",
                          }}
                        >
                          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-foreground/[0.03] px-3 py-1.5 text-[11.5px]">
                            <span className="min-w-0 flex-1 truncate">
                              <span className="text-muted-foreground">
                                {picker.mode === "definition" ? "定义" : "调用"}
                              </span>{" "}
                              <span className="font-semibold">
                                {picker.query}
                              </span>
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {picker.hits.length} 处
                              {picker.truncated ? "+" : ""}
                            </span>
                            <button
                              type="button"
                              aria-label="关闭"
                              onClick={() => setPicker(null)}
                              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                            >
                              <HugeiconsIcon
                                icon={Cancel01Icon}
                                size={12}
                                strokeWidth={2}
                              />
                            </button>
                          </div>
                          {/* 手动滚:这块是 portal 到 body 的,而弹框是 modal ——
                        Radix 用 react-remove-scroll 把弹框外的滚轮事件全
                        preventDefault 掉了,原生滚不动。自己按 deltaY 挪
                        scrollTop 就绕过去了。 */}
                          <div
                            className="min-h-0 flex-1 overflow-y-auto py-1"
                            onWheel={(e) => {
                              e.stopPropagation();
                              e.currentTarget.scrollTop += e.deltaY;
                            }}
                          >
                            {picker.hits.map((hit) => (
                              <button
                                key={`${hit.path}:${hit.line}`}
                                type="button"
                                title={`${hit.rel}:${hit.line}`}
                                onClick={() => {
                                  setPicker(null);
                                  goTo(hit.path, hit.line);
                                }}
                                className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 px-3 py-1 text-left hover:bg-primary/15"
                              >
                                {/* 定宽:文件名长短不一,不定宽的话行号和代码列
                                每行都在挪,一列都对不齐 */}
                                <span className="w-48 shrink-0 truncate text-[11.5px] text-foreground/85">
                                  {baseName(hit.rel)}
                                </span>
                                <span className="w-10 shrink-0 text-right text-[10.5px] text-muted-foreground tabular-nums">
                                  {hit.line}
                                </span>
                                {/* 代码里把这个名字挑出来加粗,一眼看到落点 */}
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                                  {hit.text
                                    .split(picker.query)
                                    .flatMap((part, i) =>
                                      i === 0
                                        ? [part]
                                        : [
                                            <span
                                              // biome-ignore lint/suspicious/noArrayIndexKey: 就是按出现次序切的片段
                                              key={i}
                                              className="font-semibold text-foreground"
                                            >
                                              {picker.query}
                                            </span>,
                                            part,
                                          ],
                                    )}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>,
                      document.body,
                    )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-44">
                <ContextMenuItem
                  className="text-[12px]"
                  disabled={!selection}
                  onSelect={() => {
                    void copyToClipboard(selection);
                    toast.success("已复制", { description: selection });
                  }}
                >
                  复制
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-[12px]"
                  disabled={!selection}
                  onSelect={() => {
                    setFindOpen(true);
                    setFindQuery(selection);
                    runFind(selection);
                  }}
                >
                  在这个文件里查找
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-[12px]"
                  disabled={!selection}
                  onSelect={() => void jumpTo(selection, "reference")}
                >
                  找调用
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-[12px]"
                  disabled={!selection}
                  onSelect={() => void jumpTo(selection, "definition")}
                >
                  跳到定义
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>
        {/* 连按两下 Shift:按名字找类/函数。
                    这块必须留在弹框**里面**:弹框是 modal,Radix 的焦点陷阱
                    会把跑到外面的焦点拽回来 —— portal 到 body 的话输入框
                    永远抢不到光标。所以用 absolute 贴着编辑区定位。 */}
        {everywhere && (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="关闭搜索"
              className="absolute inset-0 z-20 cursor-default"
              onClick={() => setEverywhere(null)}
            />
            <div className="absolute top-[10%] left-1/2 z-30 flex max-h-[28rem] w-[42rem] max-w-[calc(100%-3rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-2xl">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
                {everywhere.loading ? (
                  <Spinner className="size-3.5 shrink-0" />
                ) : (
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-muted-foreground/70"
                  />
                )}
                <input
                  ref={everywhereInputRef}
                  value={everywhere.query}
                  onChange={(e) =>
                    setEverywhere((cur) =>
                      cur ? { ...cur, query: e.target.value } : cur,
                    )
                  }
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEverywhere(null);
                    }
                    if (e.key === "Enter" && everywhere.hits[0]) {
                      const hit = everywhere.hits[0];
                      setEverywhere(null);
                      goTo(hit.path, hit.line);
                    }
                  }}
                  placeholder="类 / 函数名,打头几个字就行"
                  spellCheck={false}
                  className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                />
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto py-1"
                onWheel={(e) => {
                  e.stopPropagation();
                  e.currentTarget.scrollTop += e.deltaY;
                }}
              >
                {everywhere.query.trim().length < 2 ? (
                  <div className="px-3 py-2 text-[11.5px] text-muted-foreground">
                    至少两个字
                  </div>
                ) : everywhere.hits.length === 0 ? (
                  <div className="px-3 py-2 text-[11.5px] text-muted-foreground">
                    {everywhere.loading ? "找着…" : "没有匹配"}
                  </div>
                ) : (
                  everywhere.hits.map((hit) => (
                    <button
                      key={`${hit.path}:${hit.line}`}
                      type="button"
                      title={`${hit.rel}:${hit.line}`}
                      onClick={() => {
                        setEverywhere(null);
                        goTo(hit.path, hit.line);
                      }}
                      className="flex w-full min-w-0 cursor-pointer items-baseline gap-2 px-3 py-1 text-left hover:bg-primary/15"
                    >
                      <span className="w-48 shrink-0 truncate text-[11.5px] text-foreground/85">
                        {baseName(hit.rel)}
                      </span>
                      <span className="w-10 shrink-0 text-right text-[10.5px] text-muted-foreground tabular-nums">
                        {hit.line}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {hit.text}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
        <ResizeGrip onResize={(w, h) => setSize({ w, h })} />
      </DialogContent>
    </Dialog>
  );
}
