import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { type GitChangedFile, native } from "@/modules/ai/lib/native";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import { invalidateRepoDiffs } from "@/modules/editor/lib/diffCache";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  WORKTREE_CHANGED_EVENT,
  WORKTREE_DISCARDED_EVENT,
  type WorktreeDiscardedDetail,
} from "./events";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoRoot: string | null;
};

/** 仓库路径 → "产品 / 工程",和面包屑一个叫法。 */
function repoLabel(repoRoot: string): { product: string; project: string } {
  const parts = repoRoot
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return {
    product: parts[parts.length - 2] ?? "",
    project: parts[parts.length - 1] ?? repoRoot,
  };
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** 状态标签配色:新增绿、删除红、改动黄,和文件树的 git 着色一个意思。 */
function statusTone(f: GitChangedFile): string {
  if (f.untracked || f.statusLabel.startsWith("Added"))
    return "text-emerald-500";
  if (f.statusLabel.startsWith("Deleted")) return "text-red-400";
  if (f.statusLabel.startsWith("Renamed")) return "text-blue-400";
  return "text-amber-500";
}

/**
 * 变更文件浏览器:左边列出工作区改动,点一下右边看这个文件的 diff。
 *
 * 和"提交"浮层里那份清单的区别:那份是提交前的确认清单(点了就跳去
 * 单独的 diff tab),这里是专门用来读改动的 —— 左右分栏,来回点几个
 * 文件不用开一堆 tab。
 */
export function ChangedFilesDialog({ open, onOpenChange, repoRoot }: Props) {
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  const [selected, setSelected] = useState<GitChangedFile | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  // 丢弃不可撤销,所以点一下只是"上膛"(按钮变成"确认丢弃"),再点才执行 ——
  // 比再弹一个框轻,手也不用在两个层级之间跳。
  const [discarding, setDiscarding] = useState<GitChangedFile | null>(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  // 丢弃完要重新拉列表,复用打开时那次的 effect
  const [reloadKey, setReloadKey] = useState(0);

  // 每次打开现拉一次就够:弹框是模态的,开着的时候编辑不了文件,
  // 挂改动监听纯属空转。
  useEffect(() => {
    if (!open || !repoRoot) {
      setFiles(null);
      setSelected(null);
      return;
    }
    let alive = true;
    // diff 内容有进程内缓存(给切 tab 来回看时用的),这里必须先作废:
    // 弹框每次打开都要按当下的磁盘算,否则显示的是上次看时的旧改动。
    invalidateRepoDiffs(repoRoot);
    native
      .gitStatus(repoRoot)
      .then((s) => {
        if (!alive) return;
        setFiles(s.changedFiles);
        setSelected(s.changedFiles[0] ?? null);
        setBranch(s.branch || null);
      })
      .catch(() => {
        if (alive) setFiles([]);
      });
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey 是"重新拉一次"的信号
  }, [open, repoRoot, reloadKey]);

  const discardFile = async (f: GitChangedFile) => {
    if (!repoRoot || discardBusy) return;
    setDiscardBusy(true);
    try {
      await native.gitDiscard(repoRoot, [
        { path: f.path, untracked: f.untracked },
      ]);
      invalidateRepoDiffs(repoRoot);
      // 丢弃的是这个文件的全部改动,编辑器里没保存的那部分也一起扔
      window.dispatchEvent(
        new CustomEvent<WorktreeDiscardedDetail>(WORKTREE_DISCARDED_EVENT, {
          detail: {
            paths: [`${repoRoot.replace(/[\\/]+$/, "")}/${f.path}`],
            relPaths: [f.path],
          },
        }),
      );
      toast.success(
        f.untracked ? `已删除 ${f.path}` : `已丢弃 ${f.path} 的改动`,
      );
      setDiscarding(null);
      setReloadKey((k) => k + 1);
      // 文件树的 git 着色、提交角标都跟着这个信号刷新
      window.dispatchEvent(new Event(WORKTREE_CHANGED_EVENT));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDiscardBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[80vh] w-[88vw] max-w-none flex-col gap-0 p-0 sm:max-w-[1200px]"
      >
        {/* 三段式:左标题、中间当前产品/工程/分支、右关闭。自带的关闭按钮是
            absolute top-4,对不上这条矮头部,索性自己画一个跟着行高居中 */}
        <DialogHeader className="flex h-12 shrink-0 flex-row items-center gap-3 space-y-0 border-b border-border px-4">
          <DialogTitle className="flex shrink-0 items-center gap-2 text-sm">
            变更文件
            {files && (
              <span className="text-[12px] font-normal text-muted-foreground">
                共 {files.length} 个
              </span>
            )}
          </DialogTitle>

          {/* 改的是哪个产品/工程的哪个分支 —— 多工程并行时最容易搞混 */}
          <span className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[12px]">
            {repoRoot && (
              <span
                className="flex min-w-0 items-center gap-1.5"
                title={repoRoot}
              >
                <span className="truncate text-muted-foreground">
                  {repoLabel(repoRoot).product}
                </span>
                <span className="shrink-0 text-muted-foreground/40">/</span>
                <span className="truncate font-semibold text-emerald-500">
                  {repoLabel(repoRoot).project}
                </span>
                {branch && (
                  <span className="shrink-0 truncate text-muted-foreground">
                    ⑂ {branch}
                  </span>
                )}
              </span>
            )}
          </span>

          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 bg-secondary"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              <span className="sr-only">关闭</span>
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* 左:文件清单 */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-border py-1.5">
            {files == null ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
                <Spinner className="size-3" />
                正在统计改动…
              </div>
            ) : files.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-muted-foreground">
                工作区没有未提交的改动
              </div>
            ) : (
              files.map((f) => (
                <div
                  key={f.path}
                  className={cn(
                    "group relative flex w-full min-w-0 items-center",
                    selected?.path === f.path && "bg-accent",
                  )}
                >
                  <button
                    type="button"
                    title={f.path}
                    onClick={() => setSelected(f)}
                    className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "shrink-0 text-[10px] uppercase",
                          statusTone(f),
                        )}
                      >
                        {f.statusLabel.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {basename(f.path)}
                      </span>
                    </span>
                    {/* 同名文件常见(不同模块下的 build.gradle),把路径也摆出来 */}
                    <span className="w-full truncate pl-5 text-[11px] text-muted-foreground/60">
                      {f.path}
                    </span>
                  </button>
                  {/* 丢弃:未跟踪的是删文件,已跟踪的是还原到 HEAD,都不可撤销 */}
                  <Button
                    variant={
                      discarding?.path === f.path ? "destructive" : "ghost"
                    }
                    size="sm"
                    disabled={discardBusy}
                    title={
                      f.untracked
                        ? "删除这个未跟踪的文件(不可撤销)"
                        : "丢弃这个文件的改动,还原到上次提交(不可撤销)"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (discarding?.path === f.path) void discardFile(f);
                      else setDiscarding(f);
                    }}
                    onBlur={() => {
                      // 上了膛又跑去点别处:自动松开,别留个红按钮等着误触
                      if (discarding?.path === f.path && !discardBusy) {
                        setDiscarding(null);
                      }
                    }}
                    className={cn(
                      "absolute right-2 h-6 gap-1 px-1.5 text-[11px]",
                      discarding?.path === f.path
                        ? "opacity-100"
                        : "text-destructive opacity-0 hover:text-destructive group-hover:opacity-100",
                    )}
                  >
                    {discardBusy && discarding?.path === f.path && (
                      <Spinner className="size-3" />
                    )}
                    {discarding?.path === f.path
                      ? f.untracked
                        ? "确认删除?"
                        : "确认丢弃?"
                      : "丢弃"}
                  </Button>
                </div>
              ))
            )}
          </div>

          {/* 右:选中文件的 diff */}
          <div className="min-w-0 flex-1">
            {repoRoot && selected ? (
              <GitDiffPane
                key={`${selected.path}:${selected.unstaged ? "-" : "+"}`}
                active={open}
                chipLabel={selected.statusLabel}
                hideRepoPath
                source={{
                  kind: "working",
                  repoRoot,
                  path: selected.path,
                  // 未暂存看工作区改动,已暂存看暂存区
                  mode: selected.unstaged ? "-" : "+",
                  originalPath: selected.originalPath ?? null,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                {files?.length ? "选个文件看改动" : ""}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
