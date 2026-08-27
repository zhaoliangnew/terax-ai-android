import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useArmedConfirm } from "@/lib/useArmedConfirm";
import { cn } from "@/lib/utils";
import { type GitChangedFile, native } from "@/modules/ai/lib/native";
import { GIT_BRANCH_CHANGED_EVENT } from "@/modules/android-run/BranchChip";
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
  const [discarding, setDiscarding] = useArmedConfirm<GitChangedFile>();
  const [discardBusy, setDiscardBusy] = useState(false);
  // "丢弃全部"同样两步:先上膛,再确认
  const [discardAllArmed, setDiscardAllArmed] = useArmedConfirm<true>();
  // 丢弃完要重新拉列表,复用打开时那次的 effect
  const [reloadKey, setReloadKey] = useState(0);
  // 提交信息就在这框底下输 —— 看改动和提交本来就是一件事的两步,
  // 原来底栏 "diff" 和 "提交" 两个按钮各开一个层,来回跳
  const [msg, setMsg] = useState("");
  const [commitBusy, setCommitBusy] = useState<"local" | "push" | null>(null);

  // 每次打开现拉一次就够:弹框是模态的,开着的时候编辑不了文件,
  // 挂改动监听纯属空转。
  useEffect(() => {
    if (!open || !repoRoot) {
      setFiles(null);
      setSelected(null);
      setMsg("");
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

  /** 暂存当前分支的全部改动并提交,可选顺带推送。 */
  const commit = async (push: boolean) => {
    const message = msg.trim();
    if (!repoRoot || !message || commitBusy) return;
    setCommitBusy(push ? "push" : "local");
    try {
      // 按当下的磁盘重新算一遍要提交什么:框开着这段时间别处可能又改了
      const status = await native.gitStatus(repoRoot);
      if (status.changedFiles.length === 0) {
        toast.info("没有需要提交的改动");
        onOpenChange(false);
        return;
      }
      // 重命名要把旧路径也 add 进去,否则旧文件的删除留在工作区
      const paths = status.changedFiles.flatMap((f) =>
        f.originalPath ? [f.path, f.originalPath] : [f.path],
      );
      await native.gitStage(repoRoot, paths);
      await native.gitCommit(repoRoot, message);
      if (push) await native.gitPush(repoRoot);
      toast.success(push ? "已提交并推送" : "已提交到本地");
      setMsg("");
      invalidateRepoDiffs(repoRoot);
      window.dispatchEvent(new Event(WORKTREE_CHANGED_EVENT));
      window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      onOpenChange(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCommitBusy(null);
    }
  };

  const discardMany = async (list: GitChangedFile[], label: string) => {
    if (!repoRoot || discardBusy || list.length === 0) return;
    setDiscardBusy(true);
    try {
      await native.gitDiscard(
        repoRoot,
        list.map((f) => ({ path: f.path, untracked: f.untracked })),
      );
      invalidateRepoDiffs(repoRoot);
      const root = repoRoot.replace(/[\\/]+$/, "");
      window.dispatchEvent(
        new CustomEvent<WorktreeDiscardedDetail>(WORKTREE_DISCARDED_EVENT, {
          detail: {
            paths: list.map((f) => `${root}/${f.path}`),
            relPaths: list.map((f) => f.path),
          },
        }),
      );
      toast.success(label);
      setDiscarding(null);
      setDiscardAllArmed(null);
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new Event(WORKTREE_CHANGED_EVENT));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDiscardBusy(false);
    }
  };

  const discardFile = (f: GitChangedFile) =>
    discardMany(
      [f],
      f.untracked ? `已删除 ${f.path}` : `已丢弃 ${f.path} 的改动`,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[66vh] w-[88vw] max-w-none flex-col gap-0 p-0 sm:max-w-[1200px]"
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

          {/* 丢弃全部:同样两步确认。改动多的时候一个个点太累,但这是
              整仓库范围的不可撤销操作,按钮平时不显红,上膛后才变红 */}
          {!!files?.length && (
            <Button
              variant={discardAllArmed ? "destructive" : "ghost"}
              size="sm"
              disabled={discardBusy}
              title={`丢弃全部 ${files.length} 个文件的改动(未跟踪的文件会被删除),不可撤销`}
              onClick={() => {
                if (discardAllArmed) {
                  void discardMany(files, `已丢弃全部 ${files.length} 个文件`);
                } else {
                  setDiscardAllArmed(true);
                }
              }}
              onBlur={() => {
                if (!discardBusy) setDiscardAllArmed(null);
              }}
              className={cn(
                "h-7 shrink-0 gap-1 px-2 text-[12px]",
                !discardAllArmed && "text-destructive hover:text-destructive",
              )}
            >
              {discardBusy && discardAllArmed && <Spinner className="size-3" />}
              {discardAllArmed
                ? `确认丢弃全部 ${files.length} 个?`
                : "丢弃全部"}
            </Button>
          )}

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

        {/* 提交就在这儿收口:看完改动直接写信息提交,不用再跳去别的浮层 */}
        <div className="shrink-0 border-t border-border px-4 py-2.5">
          {/* 单行输入 + 按钮左右排:提交信息绝大多数就一句话,给它两行高
              纯属白占地方,真要写长的按 Shift+Enter 换行照样存得下 */}
          <div className="flex items-center gap-2">
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={
                files?.length
                  ? `提交信息 —— 将暂存并提交「${branch ?? "当前分支"}」的全部 ${files.length} 个改动`
                  : "工作区没有改动"
              }
              rows={1}
              disabled={commitBusy !== null || !files?.length}
              className="h-8 min-h-8 flex-1 resize-none py-1.5 text-[12px] leading-5"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!msg.trim() || commitBusy !== null || !files?.length}
              onClick={() => void commit(true)}
              className="h-8 shrink-0 gap-1 text-xs"
            >
              {commitBusy === "push" && <Spinner className="size-3" />}
              提交并推送
            </Button>
            <Button
              size="sm"
              disabled={!msg.trim() || commitBusy !== null || !files?.length}
              onClick={() => void commit(false)}
              className="h-8 shrink-0 gap-1 text-xs"
            >
              {commitBusy === "local" && <Spinner className="size-3" />}
              提交本地
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
