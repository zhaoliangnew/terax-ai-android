import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { BranchChip } from "@/modules/android-run/BranchChip";
import {
  EMPTY_TABS,
  NO_PROJECT_ROOT,
  OPEN_IN_BROWSER,
  REVEAL_RIGHT_PANEL,
  useWebTabsStore,
} from "@/modules/browser/webTabsStore";
import {
  EMPTY_PROJECT_FILES,
  ProjectFilesPane,
  type ProjectFilesState,
} from "@/modules/explorer";
import type { GitDiffOpenInput } from "@/modules/tabs";
import {
  Add01Icon,
  Cancel01Icon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen } from "@tauri-apps/api/event";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const DevicePanel = lazy(() => import("@/modules/android-run/DevicePanel"));
const WebTab = lazy(() =>
  import("@/modules/browser/WebTab").then((m) => ({ default: m.WebTab })),
);

export type RightTab = "device" | "source" | "repo";

export const RIGHT_TAB_LABELS: Record<RightTab, string> = {
  device: "投屏",
  source: "源码",
  repo: "仓库",
};

/** 投屏只对安卓/Flutter 工程有意义,别的工程落到源码。 */
export function effectiveRightTab(tab: RightTab, hasDevice: boolean): RightTab {
  return tab === "device" && !hasDevice ? "source" : tab;
}

/**
 * 源码/仓库 tab 看的是哪个目录:安卓工程就是它的工程根,别的工程取最后一个
 * 终端所在的 git 仓库根,不在仓库里就用终端目录本身(家目录除外,整棵树太大)。
 */
export function usePanelRoot(
  androidRoot: string | null,
  terminalCwd: string | null,
  home: string | null,
): string | null {
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  useEffect(() => {
    if (androidRoot || !terminalCwd) {
      setRepoRoot(null);
      return;
    }
    let alive = true;
    native
      .gitResolveRepo(terminalCwd)
      .then((r) => {
        if (alive) setRepoRoot(r?.repoRoot ?? null);
      })
      .catch(() => {
        if (alive) setRepoRoot(null);
      });
    return () => {
      alive = false;
    };
  }, [androidRoot, terminalCwd]);
  if (androidRoot) return androidRoot;
  if (repoRoot) return repoRoot;
  return terminalCwd && terminalCwd !== home ? terminalCwd : null;
}

type SourceProps = Omit<
  ComponentProps<typeof ProjectFilesPane>,
  "visible" | "rootPath" | "state" | "onStateChange"
>;

type Props = {
  tabBarHost?: HTMLElement | null;
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  /** 有安卓工程才有投屏 tab。 */
  hasDevice: boolean;
  root: string | null;
  filesState: ProjectFilesState | undefined;
  onFilesStateChange: (root: string, next: ProjectFilesState) => void;
  onOpenDiff: (input: GitDiffOpenInput) => void;
  sourceProps: SourceProps;
};

/**
 * 右栏:投屏(含 Logcat)、源码、仓库三个 tab。
 *
 * 切走只是隐藏不卸载 —— 投屏会话、打开着的文件、分支列表都留着。源码和仓库
 * 第一次点开才挂载,没用过就不拉编辑器和 git 那一套。
 */
export function RightPanel({
  tabBarHost,
  tab,
  onTabChange,
  hasDevice,
  root,
  filesState,
  onFilesStateChange,
  onOpenDiff,
  sourceProps,
}: Props) {
  const current = effectiveRightTab(tab, hasDevice);
  const [visited, setVisited] = useState<ReadonlySet<RightTab>>(
    () => new Set([current]),
  );
  useEffect(() => {
    setVisited((v) => (v.has(current) ? v : new Set([...v, current])));
  }, [current]);

  const tabs: RightTab[] = hasDevice
    ? ["device", "source", "repo"]
    : ["source", "repo"];

  // 每个工程各自的网页标签页(内嵌浏览器)。选中网页时固定 tab 让位。
  // 用固定的空数组:`?? []` 每次渲染都新建,zustand 会当成变了 → 无限刷新
  // 没进工程时也能开网页(AI 也要能开),归到一个公共组里
  const webRoot = root ?? NO_PROJECT_ROOT;
  const webRootRef = useRef(webRoot);
  webRootRef.current = webRoot;
  const allWebTabs = useWebTabsStore((s) => s.byRoot);
  const webTabs = allWebTabs[webRoot] ?? EMPTY_TABS;
  const addWebTab = useWebTabsStore((s) => s.add);
  const removeWebTab = useWebTabsStore((s) => s.remove);
  const setWebTitle = useWebTabsStore((s) => s.setTitle);
  // 每个工程各记各的选中网页:切到别的工程再切回来,还停在原来那个网页上
  const [activeWebByRoot, setActiveWebByRoot] = useState<
    Record<string, string | null>
  >({});
  const activeWeb = activeWebByRoot[webRoot] ?? null;
  const setActiveWeb = useCallback((id: string | null) => {
    const r = webRootRef.current;
    setActiveWebByRoot((m) => (m[r] === id ? m : { ...m, [r]: id }));
  }, []);
  // 选中的网页被关掉:回到固定 tab
  useEffect(() => {
    if (activeWeb && !webTabs.some((t) => t.id === activeWeb)) {
      setActiveWeb(null);
    }
  }, [activeWeb, webTabs, setActiveWeb]);

  const selectWebTab = (id: string) => {
    setActiveWeb(id);
    window.dispatchEvent(new Event(REVEAL_RIGHT_PANEL));
  };
  const openWebTab = () => {
    selectWebTab(addWebTab(webRoot, "about:blank"));
  };
  const closeWebTab = (id: string) => {
    removeWebTab(webRoot, id);
  };

  // AI 工具(terax-cli mcp)在内嵌浏览器里干活:它开的标签页加到当前这组,
  // 它操作哪个标签页就切到哪个,右栏收起了也展开 —— 用户要看得见它在做什么
  useEffect(() => {
    const offs: (() => void)[] = [];
    let alive = true;
    const keep = (p: Promise<() => void>) =>
      p.then((u) => (alive ? offs.push(u) : u())).catch(() => {});
    const show = (id: string) => {
      setActiveWeb(id);
      window.dispatchEvent(new Event(REVEAL_RIGHT_PANEL));
    };
    keep(
      listen<{ label: string; url: string }>("web://ai-open", (e) => {
        useWebTabsStore
          .getState()
          .addWithId(webRootRef.current, e.payload.label, e.payload.url);
        show(e.payload.label);
      }),
    );
    keep(
      listen<{ label: string }>("web://ai-activity", (e) => {
        const tabs =
          useWebTabsStore.getState().byRoot[webRootRef.current] ?? EMPTY_TABS;
        if (tabs.some((t) => t.id === e.payload.label)) show(e.payload.label);
      }),
    );
    // 界面里别处(聊天点了 html 文件)要开网页:新开一个标签页
    const onOpen = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url) return;
      show(useWebTabsStore.getState().add(webRootRef.current, url));
    };
    window.addEventListener(OPEN_IN_BROWSER, onOpen);
    return () => {
      alive = false;
      for (const off of offs) off();
      window.removeEventListener(OPEN_IN_BROWSER, onOpen);
    };
  }, [setActiveWeb]);
  const selectFixed = (t: RightTab) => {
    setActiveWeb(null);
    onTabChange(t);
  };

  const empty = (
    <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
      先在终端里进到一个工程目录
    </div>
  );

  const tabBar = (
    <div
      role="tablist"
      aria-label="右栏"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto bg-frame px-2",
        tabBarHost ? "h-full" : "h-11 border-b border-border/60",
      )}
    >
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={t === current && !activeWeb}
          onClick={() => selectFixed(t)}
          className={cn(
            // 选中只换底色和字色,不加粗:加粗会把字撑宽,切一下整排跳一下
            "h-8 min-w-16 shrink-0 cursor-pointer rounded-lg border border-transparent px-3 text-[13px] font-normal transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            t === current && !activeWeb
              ? "border-foreground/15 bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          {RIGHT_TAB_LABELS[t]}
        </button>
      ))}
      {/* 每个工程独立的网页标签页,跟在仓库后面 */}
      {webTabs.map((wt) => (
        <span
          key={wt.id}
          className={cn(
            "group/wt flex h-8 w-60 shrink-0 items-center gap-2 rounded-lg border border-transparent pr-1.5 pl-2.5 text-[13px] font-normal transition-colors",
            activeWeb === wt.id
              ? "border-foreground/15 bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeWeb === wt.id}
            title={wt.title}
            onClick={() => selectWebTab(wt.id)}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            <HugeiconsIcon
              icon={Globe02Icon}
              size={14}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">{wt.title}</span>
          </button>
          <button
            type="button"
            aria-label="关闭标签页"
            onClick={() => closeWebTab(wt.id)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={openWebTab}
        title="新建网页标签页"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabBarHost ? createPortal(tabBar, tabBarHost) : tabBar}
      <div className="relative min-h-0 flex-1">
        {/* 投屏一直挂着:切到非安卓工程时卸载的话,投屏会话就断了 */}
        <div
          className={cn(
            "absolute inset-0",
            (current !== "device" || activeWeb) && "hidden",
          )}
        >
          <Suspense fallback={null}>
            <DevicePanel />
          </Suspense>
        </div>
        {visited.has("source") && (
          <div
            data-right-pane="source"
            className={cn(
              "absolute inset-0",
              (current !== "source" || activeWeb) && "hidden",
            )}
          >
            {root ? (
              <ProjectFilesPane
                {...sourceProps}
                visible={current === "source"}
                rootPath={root}
                state={filesState ?? EMPTY_PROJECT_FILES}
                onStateChange={(next) => onFilesStateChange(root, next)}
              />
            ) : (
              empty
            )}
          </div>
        )}
        {visited.has("repo") && (
          <div
            className={cn(
              "absolute inset-0",
              (current !== "repo" || activeWeb) && "hidden",
            )}
          >
            {root ? (
              <BranchChip
                variant="panel"
                visible={current === "repo" && !activeWeb}
                projectRoot={root}
                onOpenDiff={onOpenDiff}
              />
            ) : (
              empty
            )}
          </div>
        )}
        {/* 网页标签页:所有工程的都挂着,切走(换 tab 或换工程)只隐藏不卸载,
            页面和登录状态都留着 */}
        {Object.entries(allWebTabs).flatMap(([r, list]) =>
          list.map((wt) => (
            // 没选中的整层藏起来:铺满右栏的空壳会挡住投屏/源码/仓库的点击
            <div
              key={wt.id}
              className={cn(
                "absolute inset-0",
                (r !== webRoot || activeWeb !== wt.id) && "hidden",
              )}
            >
              <Suspense fallback={null}>
                <WebTab
                  tabId={wt.id}
                  initialUrl={wt.url}
                  visible={r === webRoot && activeWeb === wt.id}
                  onTitle={(t) => setWebTitle(r, wt.id, t)}
                />
              </Suspense>
            </div>
          )),
        )}
      </div>
    </div>
  );
}
