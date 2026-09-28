import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { BranchChip } from "@/modules/android-run/BranchChip";
import {
  EMPTY_PROJECT_FILES,
  ProjectFilesPane,
  type ProjectFilesState,
} from "@/modules/explorer";
import type { GitDiffOpenInput } from "@/modules/tabs";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

const DevicePanel = lazy(() => import("@/modules/android-run/DevicePanel"));

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
            aria-selected={t === current}
            onClick={() => onTabChange(t)}
            className={cn(
              // 选中只换底色和字色,不加粗:加粗会把字撑宽,切一下整排跳一下
              "h-8 min-w-16 cursor-pointer rounded-md px-4 text-[13px] font-medium transition-colors",
              t === current
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {RIGHT_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* 投屏一直挂着:切到非安卓工程时卸载的话,投屏会话就断了 */}
        <div
          className={cn("absolute inset-0", current !== "device" && "hidden")}
        >
          <Suspense fallback={null}>
            <DevicePanel />
          </Suspense>
        </div>
        {visited.has("source") && (
          <div
            data-right-pane="source"
            className={cn("absolute inset-0", current !== "source" && "hidden")}
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
            className={cn("absolute inset-0", current !== "repo" && "hidden")}
          >
            {root ? (
              <BranchChip
                variant="panel"
                visible={current === "repo"}
                projectRoot={root}
                onOpenDiff={onOpenDiff}
              />
            ) : (
              empty
            )}
          </div>
        )}
      </div>
    </div>
  );
}
