import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { BranchChip } from "@/modules/android-run/BranchChip";
import { EMPTY_TABS, useWebTabsStore } from "@/modules/browser/webTabsStore";
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
import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

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
  const webTabs = useWebTabsStore((s) =>
    root ? (s.byRoot[root] ?? EMPTY_TABS) : EMPTY_TABS,
  );
  const addWebTab = useWebTabsStore((s) => s.add);
  const removeWebTab = useWebTabsStore((s) => s.remove);
  const setWebTitle = useWebTabsStore((s) => s.setTitle);
  const [activeWeb, setActiveWeb] = useState<string | null>(null);
  // 切工程、或选中的网页被关掉:回到固定 tab
  useEffect(() => {
    if (activeWeb && !webTabs.some((t) => t.id === activeWeb)) {
      setActiveWeb(null);
    }
  }, [activeWeb, webTabs]);

  const openWebTab = () => {
    if (!root) return;
    setActiveWeb(addWebTab(root, "about:blank"));
  };
  const closeWebTab = (id: string) => {
    if (root) removeWebTab(root, id);
  };
  const selectFixed = (t: RightTab) => {
    setActiveWeb(null);
    onTabChange(t);
  };

  const empty = (
    <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
      先在终端里进到一个工程目录
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="右栏"
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
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
              "h-8 min-w-16 cursor-pointer rounded-md px-4 text-[13px] font-medium transition-colors",
              t === current && !activeWeb
                ? "bg-foreground/10 text-foreground"
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
              "group/wt flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md pr-1 pl-2.5 text-[13px] transition-colors",
              activeWeb === wt.id
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => setActiveWeb(wt.id)}
              className="flex max-w-32 cursor-pointer items-center gap-1.5"
            >
              <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.75} />
              <span className="truncate">{wt.title}</span>
            </button>
            <button
              type="button"
              aria-label="关闭标签页"
              onClick={() => closeWebTab(wt.id)}
              className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-foreground/15 group-hover/wt:opacity-70 hover:!opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
        {root && (
          <button
            type="button"
            onClick={openWebTab}
            title="新建网页标签页"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
          </button>
        )}
      </div>
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
        {/* 网页标签页:各开各的 Chrome target,切走只隐藏不卸载,会话不断 */}
        {webTabs.map((wt) => (
          <div key={wt.id} className="absolute inset-0">
            <Suspense fallback={null}>
              <WebTab
                tabId={wt.id}
                initialUrl={wt.url}
                visible={activeWeb === wt.id}
                onTitle={(t) => root && setWebTitle(root, wt.id, t)}
              />
            </Suspense>
          </div>
        ))}
      </div>
    </div>
  );
}
