import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import { Cancel01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ComponentProps, lazy, Suspense } from "react";
import { FileExplorer } from "./FileExplorer";

// 编辑器整包(CodeMirror + LSP)只在真正打开弹框看文件时才拉进来。
const EditorPane = lazy(() =>
  import("@/modules/editor/EditorPane").then((m) => ({
    default: m.EditorPane,
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
        className="flex h-[82vh] w-[76rem] max-w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[calc(100vw-3rem)]"
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
          {/* 关闭放在标题行右端,跟弹框自带那个大号 X 比更贴这条窄头部 */}
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={() => onOpenChange(false)}
            className="ml-auto shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
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
          <div className="zoom-content flex min-h-0 min-w-0 flex-1 flex-col bg-background">
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
            {/* 每个开着的文件各留一个 EditorPane 挂着,切 tab 只是显隐 ——
                卸载会把没保存的改动和滚动位置一起丢掉 */}
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
                      <EditorPane path={path} />
                    </Suspense>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
