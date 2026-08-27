import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useArmedConfirm } from "@/lib/useArmedConfirm";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  type GitChangedFile,
  type GitCommitFileChange,
  type GitCommitMeta,
  type GitLogEntry,
  type GitTagEntry,
  native,
} from "@/modules/ai/lib/native";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import { invalidateRepoDiffs } from "@/modules/editor/lib/diffCache";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import type { GitDiffOpenInput } from "@/modules/tabs";
import {
  ArrowUp01Icon,
  CheckmarkCircle01Icon,
  Download01Icon,
  GitBranchIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { shellQuote } from "./lib/openExternally";

type RepoInfo = { repoRoot: string; branch: string };

/**
 * 应用内切完分支后广播这个事件:分支名在各处(顶栏/底栏/工具栏/输入栏)
 * 是互不相干的本地缓存,不广播的话只有发起切换的那个 chip 立刻变,
 * 其它的要干等下一轮轮询,期间界面自相矛盾。
 */
export const GIT_BRANCH_CHANGED_EVENT = "terax:git-branch-changed";

/**
 * 当前工程在哪个分支。
 *
 * 隔一会儿重问一次,外加窗口回到前台时立刻问 —— 分支是在终端里 `git checkout`
 * 改的,应用这边收不到通知;而"以为在 A 分支其实在 B"是这个工具最容易惹出的
 * 事故(编译安装到设备上才发现装错版本)。一次 git 调用很便宜。
 */
function useProjectRepo(root: string | null): RepoInfo | null {
  const [repo, setRepo] = useState<RepoInfo | null>(null);

  useEffect(() => {
    if (!root) {
      setRepo(null);
      return;
    }
    let alive = true;
    const read = () => {
      native
        .gitResolveRepo(root)
        .then((r) => {
          if (alive) {
            setRepo(
              r?.branch ? { repoRoot: r.repoRoot, branch: r.branch } : null,
            );
          }
        })
        .catch(() => {
          if (alive) setRepo(null);
        });
    };
    read();
    const timer = setInterval(read, 15_000);
    window.addEventListener("focus", read);
    window.addEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
      window.removeEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    };
  }, [root]);

  return repo;
}

/** 兼容旧用法:只要分支名字符串。 */
export function useProjectBranch(root: string | null): string | null {
  return useProjectRepo(root)?.branch ?? null;
}

/** origin 的仓库地址;没有 git 仓库或没配 remote 就是 null。 */
function useRepoRemoteUrl(
  root: string | null,
  refreshSignal = 0,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal 是改完地址后的重读信号
  useEffect(() => {
    if (!root) {
      setUrl(null);
      return;
    }
    let alive = true;
    native
      .gitResolveRepo(root)
      .then((r) => (r ? native.gitRemoteUrl(r.repoRoot) : null))
      .then((u) => {
        if (alive) setUrl(u ?? null);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [root, refreshSignal]);
  return url;
}

/**
 * 仓库地址一小条:点地址复制,后面跟一个小铅笔按钮改 origin 地址。
 * 不用双击改 —— 双击会先发两次 click,复制提示会抢在弹框前面冒出来。
 * 改远程地址是高危操作(推错仓库不好收拾),所以弹框里把老地址原样
 * 摆出来对照,并且要再确认一次才真改。
 */
export function RepoUrlChip({
  projectRoot,
  className,
}: {
  projectRoot: string | null;
  className?: string;
}) {
  const [rev, setRev] = useState(0);
  const url = useRepoRemoteUrl(projectRoot, rev);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  if (!url) return null;

  const next = draft.trim();
  const changed = next !== "" && next !== url;

  const applyUrl = async () => {
    if (!projectRoot || !changed || busy) return;
    setBusy(true);
    try {
      const repo = await native.gitResolveRepo(projectRoot);
      if (!repo) throw new Error("这个目录不是 git 仓库");
      const out = await native.runCommand(
        `git -C ${shellQuote(repo.repoRoot)} remote set-url origin ${shellQuote(next)}`,
        null,
        30,
      );
      if (out.exit_code !== 0) {
        throw new Error(out.stderr || out.stdout || "修改失败");
      }
      toast.success("远程地址已修改");
      setRev((n) => n + 1);
      setEditing(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className={cn("group flex min-w-0 items-center gap-1", className)}>
        <button
          type="button"
          title={`${url} · 点击复制`}
          onClick={() => {
            void copyToClipboard(url);
            toast.success("仓库地址已复制");
          }}
          className="min-w-0 cursor-pointer truncate text-left text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          {url}
        </button>
        <button
          type="button"
          title="修改远程仓库地址"
          onClick={() => {
            setDraft(url);
            setEditing(true);
          }}
          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={11} strokeWidth={1.75} />
        </button>
      </span>

      <Dialog
        open={editing}
        onOpenChange={(o) => {
          if (!o && !busy) setEditing(false);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">修改远程仓库地址</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-destructive">
              高危操作:改完之后这个工程的推送/拉取都会指向新地址,
              推错仓库不好收拾。确认新地址是你要的再改。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              当前地址
            </div>
            <div className="rounded border border-border/60 bg-foreground/[0.03] px-2 py-1.5 font-mono text-[11px] break-all text-muted-foreground">
              {url}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              新地址
            </div>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && changed) void applyUrl();
              }}
              spellCheck={false}
              disabled={busy}
              className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="text-xs"
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !changed}
              onClick={() => void applyUrl()}
              className="gap-1 text-xs"
            >
              {busy && <Spinner className="size-3" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 工程挂着 worktree 时显示 "worktree N" 徽标(N 带圆形底),
 * 没有就什么都不画。跟着分支变更事件刷新。
 */
export function WorktreeCountBadge({
  projectRoot,
  className,
}: {
  projectRoot: string | null;
  className?: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!projectRoot) {
      setCount(0);
      return;
    }
    let alive = true;
    const read = () => {
      native
        .gitResolveRepo(projectRoot)
        .then((r) => (r ? native.gitListBranches(r.repoRoot) : null))
        .then((res) => {
          if (alive) {
            setCount(
              res?.branches.filter((b) => b.kind === "worktree").length ?? 0,
            );
          }
        })
        .catch(() => {
          if (alive) setCount(0);
        });
    };
    read();
    window.addEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    };
  }, [projectRoot]);

  if (count <= 0) return null;
  return (
    // 写全 "worktree" 一行里太占地方,试过图标又都像分支 —— 缩写成 tree
    <span
      className={cn(
        "flex shrink-0 items-stretch overflow-hidden rounded",
        className,
      )}
      title={`${count} 个 worktree`}
    >
      <span className="bg-foreground/10 px-1 py-px text-[10.5px] leading-4 text-muted-foreground">
        tree
      </span>
      <span className="bg-foreground/20 px-1 py-px text-[10.5px] leading-4 font-semibold text-foreground/85 tabular-nums">
        {count}
      </span>
    </span>
  );
}

/** 变更文件 → 打开 diff 用的参数。unstaged 看工作区改动,staged 看暂存区。 */
function diffInputFor(repoRoot: string, f: GitChangedFile): GitDiffOpenInput {
  return {
    path: f.path,
    repoRoot,
    mode: f.unstaged ? "-" : "+",
    originalPath: f.originalPath ?? null,
  };
}

/** 提交弹框里的改动预览:多少个文件、分别是哪些。 */
function ChangedFilesPreview({
  repoRoot,
  active,
  onOpenFile,
}: {
  repoRoot: string | null;
  active: boolean;
  /** 点某个文件:打开它的 diff。不传就是纯展示。 */
  onOpenFile?: (file: GitChangedFile) => void;
}) {
  const [files, setFiles] = useState<GitChangedFile[] | null>(null);
  useEffect(() => {
    if (!active || !repoRoot) {
      setFiles(null);
      return;
    }
    let alive = true;
    native
      .gitStatus(repoRoot)
      .then((s) => {
        if (alive) setFiles(s.changedFiles);
      })
      .catch(() => {
        if (alive) setFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [active, repoRoot]);
  if (!active) return null;
  return (
    // min-w-0:在 Dialog 的 grid 里长路径会把整个弹窗撑宽,列表里的
    // truncate 也就永远轮不到生效
    <div className="min-w-0 text-xs text-muted-foreground">
      {files == null ? (
        <span className="flex items-center gap-2">
          <Spinner className="size-3" />
          正在统计改动…
        </span>
      ) : files.length === 0 ? (
        <div>工作区没有未提交的改动</div>
      ) : (
        <>
          <div>
            共{" "}
            <span className="font-semibold text-foreground">
              {files.length}
            </span>{" "}
            个文件改动:
          </div>
          <div className="mt-1 max-h-36 overflow-y-auto rounded border border-border/60 p-1.5 font-mono text-[11px] leading-relaxed">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                disabled={!onOpenFile}
                title={onOpenFile ? `${f.path} · 点击看 diff` : f.path}
                onClick={() => onOpenFile?.(f)}
                className="flex w-full items-center gap-2 rounded px-0.5 text-left enabled:cursor-pointer enabled:hover:bg-accent/60"
              >
                {/* w-16 才装得下 "Untracked";再窄就溢出和路径粘成一串 */}
                <span className="w-16 shrink-0 truncate text-muted-foreground/70">
                  {f.statusLabel}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** `origin/feature/foo` → `feature/foo`:去掉的是 remote 名,不是路径段。 */
function remoteShortName(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function fileBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** 工作区改动的状态配色,和"变更文件"弹框一个口径。 */
function workingStatusTone(f: GitChangedFile): string {
  if (f.untracked || f.statusLabel.startsWith("Added"))
    return "text-emerald-500";
  if (f.statusLabel.startsWith("Deleted")) return "text-red-400";
  if (f.statusLabel.startsWith("Renamed")) return "text-blue-400";
  return "text-amber-500";
}

/** 提交里单个文件的状态配色:新增绿、删除红、改名蓝、其余(改动)黄。 */
function commitStatusTone(status: string): string {
  const s = status.toUpperCase();
  if (s.startsWith("A")) return "text-emerald-500";
  if (s.startsWith("D")) return "text-red-400";
  if (s.startsWith("R") || s.startsWith("C")) return "text-blue-400";
  return "text-amber-500";
}

/** 时间戳(秒)→ `2026/08/24 20:01`。 */
function formatCommitTime(secs: number): string {
  const d = new Date(secs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Props = {
  projectRoot: string | null;
  className?: string;
  /** 只要文字,不要图标也不可点(水印那种大字底下用)。 */
  bare?: boolean;
  /** 点改动文件打开它的 diff(git-diff tab)。 */
  onOpenDiff?: (input: GitDiffOpenInput) => void;
};

/**
 * 分支名。没有 git 仓库就什么都不画,不占位置。
 *
 * 非 bare 时点击弹本地分支列表,选中即 checkout;工作区有未提交改动就
 * 弹框拦下 —— 带着脏文件 checkout 成功与否全看运气,失败一半还会把人
 * 留在半切换状态,不如一开始就要求先提交。
 */
export function BranchChip({
  projectRoot,
  className,
  bare,
  onOpenDiff,
}: Props) {
  const repo = useProjectRepo(projectRoot);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // 有未提交改动时被拦下的那次切换:记住目标分支,等提交完成后继续
  const [pendingSwitch, setPendingSwitch] = useState<{
    branch: string;
    count: number;
  } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [busyAction, setBusyAction] = useState<
    "local" | "push" | "discard" | null
  >(null);
  // 丢弃是不可逆的,第一次点只是"上膛",再点一次才真执行
  const [discardArmed, setDiscardArmed] = useArmedConfirm<true>();
  // worktree 区:进行中的操作、待二次确认删除的路径
  const [wtBusy, setWtBusy] = useState(false);
  const [wtRemoveArm, setWtRemoveArm] = useArmedConfirm<string>();
  // 待确认的 worktree 创建:点 + 只是把参数存这里,确认弹框里才真建
  const [pendingWorktree, setPendingWorktree] = useState<{
    baseRef: string;
    shortName: string;
    label: string;
  } | null>(null);
  // worktree_ 后面的那截由用户在确认框里定,默认给个来源名
  const [wtSuffix, setWtSuffix] = useState("");
  // 待确认的新建分支(右键"基于此分支/提交新建分支")
  const [pendingNewBranch, setPendingNewBranch] = useState<{
    baseRef: string;
    label: string;
  } | null>(null);
  const [nbName, setNbName] = useState("");
  const [nbBusy, setNbBusy] = useState(false);
  // 待确认的合并:把 ref 合并进当前分支
  const [pendingMerge, setPendingMerge] = useState<{
    ref: string;
    display: string;
  } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // 待确认删除的分支;remote 非空表示删的是远程分支
  const [pendingDelete, setPendingDelete] = useState<{
    branch: string;
    remote: string | null;
    display: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 顶部操作栏(拉取/推送/抓取)与"仅提交"弹框
  const [syncBusy, setSyncBusy] = useState<"pull" | "push" | "fetch" | null>(
    null,
  );
  // 右键"推送到远端同名分支"进行中的分支名
  const [pushingBranch, setPushingBranch] = useState<string | null>(null);
  const [commitOnlyOpen, setCommitOnlyOpen] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  // 单击选中的分支(右侧展示它的提交记录),双击才是切换
  const [selected, setSelected] = useState<{
    display: string;
    refName: string;
    checkoutName: string;
    isHead: boolean;
  } | null>(null);
  const [logEntries, setLogEntries] = useState<GitLogEntry[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  // 标签在左栏最上面,默认只露最新那个,展开才全列(几十上百个,
  // 全摊开会把分支挤到看不见)
  const [tags, setTags] = useState<GitTagEntry[] | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  // 点提交记录里某条打开的提交详情
  const [openCommit, setOpenCommit] = useState<GitLogEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFileChange[] | null>(
    null,
  );
  const [commitFilesError, setCommitFilesError] = useState<string | null>(null);
  const [commitFile, setCommitFile] = useState<GitCommitFileChange | null>(
    null,
  );
  // 提交的完整说明和元信息(父提交/作者/日期/ref),照 SourceTree 摆在文件清单下面
  const [commitMeta, setCommitMeta] = useState<GitCommitMeta | null>(null);
  // 工作区未提交的改动:提交记录最上面那条"未提交的更改",选中后下面
  // 看的就是工作区 diff 而不是某个提交的
  const [workingFiles, setWorkingFiles] = useState<GitChangedFile[] | null>(
    null,
  );
  const [workingOpen, setWorkingOpen] = useState(false);
  const [workingFile, setWorkingFile] = useState<GitChangedFile | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const checkoutInFlight = useRef(false);
  const repoRoot = repo?.repoRoot ?? null;
  // 当前面板开在一个 worktree 上:不给再建 worktree(会套娃出
  // A/.worktree/B),Rust 侧也有同样的拦截兜底
  const inWorktree = !!repoRoot && /\/\.worktree\/[^/]+$/.test(repoRoot);

  // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion 是 worktree 增删后"重新拉一次列表"的信号
  useEffect(() => {
    if (!open || !repoRoot) return;
    let alive = true;
    setBranches(null);
    setListError(null);
    setWtRemoveArm(null);
    native
      .gitListBranches(repoRoot)
      .then((r) => {
        if (alive) setBranches(r.branches);
      })
      .catch((e) => {
        if (alive) setListError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [open, repoRoot, listVersion]);

  // 标签单独拉一次:for-each-ref 跟分支列表是两条命令,合在一起会让
  // 分支列表白等标签(标签多的仓库要几百毫秒),分开各显示各的
  // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion 是拉取/推送后的重读信号
  useEffect(() => {
    if (!open || !repoRoot) return;
    let alive = true;
    setTags(null);
    native
      .gitTags(repoRoot)
      .then((r) => {
        if (alive) setTags(r);
      })
      .catch(() => {
        // 标签读不到不该顶掉分支面板,当成"没有标签"
        if (alive) setTags([]);
      });
    return () => {
      alive = false;
    };
  }, [open, repoRoot, listVersion]);

  // 工作区改动:开框时拉一次,提交/拉取/切分支之后(listVersion 变)再拉
  // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion 是"重新拉一次"的信号
  useEffect(() => {
    if (!open || !repoRoot) return;
    let alive = true;
    // 工作区 diff 有进程内缓存,重新读之前先作废,否则看到的是上次的
    invalidateRepoDiffs(repoRoot);
    native
      .gitStatus(repoRoot)
      .then((st) => {
        if (alive) setWorkingFiles(st.changedFiles);
      })
      .catch(() => {
        if (alive) setWorkingFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [open, repoRoot, listVersion]);

  // 默认选中谁:当前分支有没提交的改动就选"未提交的更改"(和 SourceTree
  // 一样,一进来先看见自己手上那摊),否则选最新一条提交。每个 ref 只自动
  // 选一次 —— 用户手点过之后不能再被抢回去。
  const autoPickedRef = useRef<string | null>(null);
  // 关掉再开要重新自动选一次(这中间工作区可能已经被提交干净了)
  useEffect(() => {
    if (!open) autoPickedRef.current = null;
  }, [open]);
  // 选中"未提交的更改"后文件才到:补选第一个,不然右边空着
  useEffect(() => {
    if (!workingOpen || workingFile) return;
    setWorkingFile(workingFiles?.[0] ?? null);
  }, [workingOpen, workingFile, workingFiles]);

  // 打开提交详情:拉这个提交改了哪些文件,默认选中第一个直接看到 diff
  const openCommitSha = openCommit?.sha ?? null;
  useEffect(() => {
    if (!repoRoot || !openCommitSha) return;
    let alive = true;
    setCommitFiles(null);
    setCommitFile(null);
    setCommitFilesError(null);
    setCommitMeta(null);
    // 说明正文单独一条命令:git log 是按行解析的,%b 里的换行会把它拆散
    native
      .gitCommitMeta(repoRoot, openCommitSha)
      .then((m) => {
        if (alive) setCommitMeta(m);
      })
      .catch(() => {
        // 元信息拿不到不影响看 diff,静默算了
      });
    native
      .gitCommitFiles(repoRoot, openCommitSha)
      .then((r) => {
        if (!alive) return;
        setCommitFiles(r);
        setCommitFile(r[0] ?? null);
      })
      .catch((e) => {
        if (alive) setCommitFilesError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [repoRoot, openCommitSha]);

  // 被 worktree 占用的分支也算本地分支,一并列出来(带标记);
  // 排除 worktree 里 detached 的假名目
  const localBranches = useMemo(
    () =>
      branches?.filter(
        (b) => b.kind === "local" || (b.kind === "worktree" && !b.isDetached),
      ) ?? [],
    [branches],
  );
  // 远端有哪些分支,和本地有没有同名分支是两码事 —— 以前按短名去重,
  // 结果本地跟得比较全的工程一条远程分支都不剩(实测某工程 4 个远程 ref
  // 被吃掉 3 个,整节消失)。全列出来,重复也认。
  // 选中远程分支时用短名 checkout,git 会自动建出跟踪它的本地分支。
  const remoteBranches = useMemo(
    () => branches?.filter((b) => b.kind === "remote") ?? [],
    [branches],
  );
  // 下半改动区的数据源:选了"未提交的更改"就是工作区,否则是那条提交。
  // 两边字段对不上(工作区没有增删行数,提交没有 untracked),这里抹平成
  // 一份行模型,省得下面两套几乎一样的 JSX。
  const changeRowsError = workingOpen ? null : commitFilesError;
  const changeRows = useMemo(() => {
    if (workingOpen) {
      if (workingFiles == null) return null;
      return workingFiles.map((f) => ({
        key: `w:${f.path}`,
        path: f.path,
        originalPath: f.originalPath,
        letter: f.untracked ? "U" : f.statusLabel.slice(0, 1),
        tone: workingStatusTone(f),
        label: f.statusLabel,
        isBinary: false,
        added: null as number | null,
        removed: null as number | null,
        selected: workingFile?.path === f.path,
        onPick: () => setWorkingFile(f),
      }));
    }
    if (commitFiles == null) return null;
    return commitFiles.map((f) => ({
      key: `c:${f.status}:${f.path}`,
      path: f.path,
      originalPath: f.originalPath,
      letter: f.status.slice(0, 1),
      tone: commitStatusTone(f.status),
      label: f.statusLabel,
      isBinary: f.isBinary,
      added: f.added as number | null,
      removed: f.removed as number | null,
      selected: commitFile?.path === f.path,
      onPick: () => setCommitFile(f),
    }));
  }, [workingOpen, workingFiles, workingFile, commitFiles, commitFile]);

  const diffSource = useMemo(() => {
    if (!repoRoot) return null;
    if (workingOpen) {
      if (!workingFile) return null;
      return {
        kind: "working" as const,
        repoRoot,
        path: workingFile.path,
        // 未暂存看工作区改动,已暂存看暂存区
        mode: workingFile.unstaged ? ("-" as const) : ("+" as const),
        originalPath: workingFile.originalPath ?? null,
      };
    }
    if (!openCommit || !commitFile) return null;
    return {
      kind: "commit" as const,
      repoRoot,
      sha: openCommit.sha,
      path: commitFile.path,
      originalPath: commitFile.originalPath ?? null,
    };
  }, [repoRoot, workingOpen, workingFile, openCommit, commitFile]);
  const diffKey = workingOpen
    ? `working:${workingFile?.path ?? ""}`
    : `${openCommit?.sha ?? ""}:${commitFile?.path ?? ""}`;
  const diffChipLabel = workingOpen
    ? workingFile?.statusLabel
    : commitFile?.statusLabel;

  const worktrees = useMemo(
    () => branches?.filter((b) => b.kind === "worktree") ?? [],
    [branches],
  );

  // 确认框每次打开,后缀都回到默认值(来源分支名/短 SHA)
  useEffect(() => {
    setWtSuffix(pendingWorktree?.shortName ?? "");
  }, [pendingWorktree]);

  // 新建分支确认框每次打开,清空上次输入的名字
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingNewBranch 是"确认框换了目标"的重置信号
  useEffect(() => {
    setNbName("");
  }, [pendingNewBranch]);

  const createNewBranch = useCallback(async () => {
    const target = pendingNewBranch;
    const name = nbName.trim();
    if (!repoRoot || !target || !name || nbBusy) return;
    setNbBusy(true);
    try {
      await native.gitCreateBranch(repoRoot, name, target.baseRef);
      toast.success(`分支 ${name} 已创建`);
      setPendingNewBranch(null);
      setListVersion((v) => v + 1);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setNbBusy(false);
    }
  }, [repoRoot, pendingNewBranch, nbName, nbBusy]);

  // 删除确认框换目标时清掉上一次的报错
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingDelete 是"确认框换了目标"的重置信号
  useEffect(() => {
    setDeleteError(null);
  }, [pendingDelete]);

  // 合并确认框换目标时同样清掉上次的报错
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingMerge 是"确认框换了目标"的重置信号
  useEffect(() => {
    setMergeError(null);
  }, [pendingMerge]);

  const mergeBranch = useCallback(async () => {
    const target = pendingMerge;
    if (!repoRoot || !target || mergeBusy) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      await native.gitMerge(repoRoot, target.ref);
      toast.success(
        `已把 ${target.display} 合并到 ${repo?.branch ?? "当前分支"}`,
      );
      setPendingMerge(null);
      // 分支列表和右侧提交记录都重拉(log 的 effect 也挂着 listVersion)
      setListVersion((v) => v + 1);
      window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
    } catch (e) {
      // 冲突等失败留在确认框里,现场(可能已进入冲突状态)交给用户处理
      setMergeError(String(e));
    } finally {
      setMergeBusy(false);
    }
  }, [repoRoot, repo, pendingMerge, mergeBusy]);

  const runSync = useCallback(
    async (action: "pull" | "push" | "fetch") => {
      if (!repoRoot || syncBusy) return;
      setSyncBusy(action);
      try {
        if (action === "fetch") {
          // 抓取只更新远程分支指针,不动工作区 —— 想先看看别人推了啥
          await native.gitFetch(repoRoot);
          toast.success("抓取完成");
        } else if (action === "pull") {
          await native.gitPullFfOnly(repoRoot);
          toast.success("拉取完成");
          window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
        } else {
          const r = await native.gitPush(repoRoot);
          toast.success(r.pushed ? "推送完成" : "没有需要推送的提交");
        }
        setListVersion((v) => v + 1);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setSyncBusy(null);
      }
    },
    [repoRoot, syncBusy],
  );

  /** 把某个本地分支推到远端同名分支上,不用先切过去。 */
  const pushBranch = useCallback(
    async (branch: string) => {
      if (!repoRoot || pushingBranch) return;
      setPushingBranch(branch);
      try {
        const r = await native.gitPushBranch(repoRoot, branch);
        toast.success(
          r.pushed
            ? `已推送 ${branch} → ${r.remote ?? "origin"}/${branch}`
            : `${branch} 没有需要推送的提交`,
        );
        setListVersion((v) => v + 1);
      } catch (e) {
        toast.error(String(e));
      } finally {
        setPushingBranch(null);
      }
    },
    [repoRoot, pushingBranch],
  );

  // 只提交不切分支(顶部"提交"按钮)
  const commitOnly = useCallback(
    async (push: boolean) => {
      const message = commitMsg.trim();
      if (!repoRoot || !message || checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      setBusyAction(push ? "push" : "local");
      try {
        const status = await native.gitStatus(repoRoot);
        if (status.changedFiles.length === 0) {
          toast.info("没有需要提交的改动");
          setCommitOnlyOpen(false);
          return;
        }
        const paths = status.changedFiles.flatMap((f) =>
          f.originalPath ? [f.path, f.originalPath] : [f.path],
        );
        await native.gitStage(repoRoot, paths);
        await native.gitCommit(repoRoot, message);
        if (push) await native.gitPush(repoRoot);
        toast.success(push ? "已提交并推送" : "已提交到本地");
        setCommitOnlyOpen(false);
        setCommitMsg("");
        setListVersion((v) => v + 1);
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      } catch (e) {
        toast.error(String(e));
      } finally {
        checkoutInFlight.current = false;
        setBusyAction(null);
      }
    },
    [repoRoot, commitMsg],
  );

  /** 工作区干净时,"提交"框改成只改上一条提交的说明(git commit --amend)。 */
  const amendMode = commitOnlyOpen && (workingFiles?.length ?? 0) === 0;
  // 每次开框只预填一次,填完用户改了字不能被覆盖
  const amendPrefilledRef = useRef(false);
  useEffect(() => {
    if (!commitOnlyOpen) {
      amendPrefilledRef.current = false;
      return;
    }
    if (!amendMode || amendPrefilledRef.current || !repoRoot) return;
    amendPrefilledRef.current = true;
    native
      .gitCommitMeta(repoRoot, "HEAD")
      .then((m) => {
        setCommitMsg(m.body ? `${m.subject}\n\n${m.body}` : m.subject);
      })
      .catch(() => {
        // 读不到就让用户自己写
      });
  }, [commitOnlyOpen, amendMode, repoRoot]);

  const amendMessage = useCallback(async () => {
    const message = commitMsg.trim();
    if (!repoRoot || !message || busyAction !== null) return;
    setBusyAction("local");
    try {
      await native.gitAmendMessage(repoRoot, message);
      toast.success("已修改上次提交的说明");
      setCommitOnlyOpen(false);
      setCommitMsg("");
      setListVersion((v) => v + 1);
      window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyAction(null);
    }
  }, [repoRoot, commitMsg, busyAction]);

  // 待删的本地分支在远程的对应物(origin 之类),有才显示"删除本地和远程"
  const deleteRemoteCounterpart = useMemo(() => {
    if (!pendingDelete || pendingDelete.remote || !branches) return null;
    const hit = branches.find(
      (b) =>
        b.kind === "remote" && remoteShortName(b.name) === pendingDelete.branch,
    );
    return hit ? (hit.name.split("/")[0] ?? null) : null;
  }, [pendingDelete, branches]);

  const deleteBranch = useCallback(
    async (force: boolean, alsoRemote = false) => {
      const target = pendingDelete;
      if (!repoRoot || !target || deleteBusy) return;
      setDeleteBusy(true);
      setDeleteError(null);
      try {
        await native.gitDeleteBranch(repoRoot, target.branch, {
          remote: target.remote ?? undefined,
          force,
        });
        // 本地删干净了再动远程 —— 本地删失败(比如未合并)时远程不能先没了
        if (alsoRemote && !target.remote && deleteRemoteCounterpart) {
          await native.gitDeleteBranch(repoRoot, target.branch, {
            remote: deleteRemoteCounterpart,
          });
        }
        toast.success(
          alsoRemote && deleteRemoteCounterpart
            ? `已删除本地和远程分支 ${target.branch}`
            : `已删除${target.display}`,
        );
        setPendingDelete(null);
        // 删的可能正是选中的分支,清掉让它回落到当前分支
        setSelected(null);
        setListVersion((v) => v + 1);
      } catch (e) {
        // 报错留在确认框里(比如"未合并"),本地分支可以就地转强制删除
        setDeleteError(String(e));
      } finally {
        setDeleteBusy(false);
      }
    },
    [repoRoot, pendingDelete, deleteBusy, deleteRemoteCounterpart],
  );

  // 打开弹框默认选中当前分支;关闭清掉,免得下次带着旧选中打开
  const currentBranch = repo?.branch ?? null;
  useEffect(() => {
    if (!open) {
      setSelected(null);
      return;
    }
    if (currentBranch) {
      setSelected(
        (cur) =>
          cur ?? {
            display: currentBranch,
            refName: currentBranch,
            checkoutName: currentBranch,
            isHead: true,
          },
      );
    }
  }, [open, currentBranch]);

  // 只认 refName 字符串,不认 selected 对象本身:双击会连发两次单击,
  // 每次都造新对象的话这里就重载两遍,右栏跟着闪
  const selectedRef = selected?.refName ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换分支/标签就重新自动选一次
  useEffect(() => {
    autoPickedRef.current = null;
  }, [selectedRef]);
  useEffect(() => {
    if (!open || !selectedRef) return;
    if (autoPickedRef.current === selectedRef) return;
    if (logEntries == null) return;
    // 当前分支得等工作区状态到齐再定,否则会先选中提交、再跳到未提交,闪一下
    if (selected?.isHead && workingFiles == null) return;
    autoPickedRef.current = selectedRef;
    if (selected?.isHead && (workingFiles?.length ?? 0) > 0) {
      setWorkingOpen(true);
      setWorkingFile(workingFiles?.[0] ?? null);
      setOpenCommit(null);
    } else {
      setWorkingOpen(false);
      setOpenCommit(logEntries[0] ?? null);
    }
  }, [open, selectedRef, logEntries, workingFiles, selected?.isHead]);

  useEffect(() => {
    if (!open || !repoRoot || !selectedRef) return;
    let alive = true;
    setLogEntries(null);
    setLogError(null);
    native
      .gitLog(repoRoot, { limit: 50, refName: selectedRef })
      .then((r) => {
        if (!alive) return;
        setLogEntries(r);
      })
      .catch((e) => {
        if (alive) setLogError(String(e));
      });
    return () => {
      alive = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion 是拉取/合并等改了提交记录后的重读信号
  }, [open, repoRoot, selectedRef, listVersion]);

  // 同一分支重复单击不重建选中对象,避免无谓的重渲染
  const selectBranch = useCallback(
    (sel: {
      display: string;
      refName: string;
      checkoutName: string;
      isHead: boolean;
    }) => {
      // 换分支不收改动区:上面拉完新分支的提交记录会自动选中最新那条,
      // 收掉再展开会让整块闪一下
      setSelected((cur) => (cur && cur.refName === sel.refName ? cur : sel));
    },
    [],
  );

  const createWorktree = useCallback(
    async (baseRef: string, shortName: string): Promise<boolean> => {
      if (!repoRoot || wtBusy) return false;
      setWtBusy(true);
      try {
        // 基于所选起点新建 worktree_ 前缀的分支挂载,原分支保持自由
        const path = await native.gitWorktreeAdd(
          repoRoot,
          baseRef,
          `worktree_${shortName}`,
        );
        toast.success(`Worktree 已创建(分支 worktree_${shortName}):${path}`);
        setListVersion((v) => v + 1);
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
        return true;
      } catch (e) {
        toast.error(String(e));
        return false;
      } finally {
        setWtBusy(false);
      }
    },
    [repoRoot, wtBusy],
  );

  const removeWorktree = useCallback(
    async (worktreePath: string) => {
      if (!repoRoot || wtBusy) return;
      setWtBusy(true);
      try {
        await native.gitWorktreeRemove(repoRoot, worktreePath);
        setWtRemoveArm(null);
        setListVersion((v) => v + 1);
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      } catch (e) {
        toast.error(String(e));
      } finally {
        setWtBusy(false);
      }
    },
    [repoRoot, wtBusy, setWtRemoveArm],
  );

  const handleCheckout = useCallback(
    async (branch: string) => {
      if (!repoRoot || checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      setCheckingOut(true);
      try {
        // 先查一遍 status 而不是等 checkout 自己报错:git 对"脏但不冲突"
        // 会默默带着改动切过去,那才是最坑的 —— 必须在动手前拦住。
        const status = await native.gitStatus(repoRoot);
        if (status.changedFiles.length > 0) {
          setCommitMsg("");
          setDiscardArmed(null);
          setPendingSwitch({ branch, count: status.changedFiles.length });
          setOpen(false);
          return;
        }
        await native.gitCheckoutBranch(repoRoot, branch);
        setOpen(false);
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      } catch (e) {
        toast.error(String(e));
      } finally {
        checkoutInFlight.current = false;
        setCheckingOut(false);
      }
    },
    [repoRoot, setDiscardArmed],
  );

  const commitAndSwitch = useCallback(
    async (push: boolean) => {
      const target = pendingSwitch;
      const message = commitMsg.trim();
      if (!repoRoot || !target || !message || checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      setBusyAction(push ? "push" : "local");
      try {
        // 重新取一次 status:弹框开着的这段时间文件可能又变了,提交
        // 就该把当下的全部改动带上,而不是弹框那一刻的快照。
        const status = await native.gitStatus(repoRoot);
        // 重命名要把旧路径也 add 进去,否则旧文件的删除留在工作区
        const paths = status.changedFiles.flatMap((f) =>
          f.originalPath ? [f.path, f.originalPath] : [f.path],
        );
        await native.gitStage(repoRoot, paths);
        await native.gitCommit(repoRoot, message);
        if (push) {
          try {
            await native.gitPush(repoRoot);
          } catch (e) {
            // 提交已经落盘,推送挂了不该回头装作没提交;明说现状,
            // 分支也不切,让用户处理完推送问题再自己切。
            toast.error(`已提交到本地,但推送失败:${String(e)};分支未切换`);
            setPendingSwitch(null);
            return;
          }
        }
        await native.gitCheckoutBranch(repoRoot, target.branch);
        setPendingSwitch(null);
        setCommitMsg("");
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      } catch (e) {
        toast.error(String(e));
      } finally {
        checkoutInFlight.current = false;
        setBusyAction(null);
      }
    },
    [repoRoot, pendingSwitch, commitMsg],
  );

  const discardAndSwitch = useCallback(async () => {
    const target = pendingSwitch;
    if (!repoRoot || !target || checkoutInFlight.current) return;
    checkoutInFlight.current = true;
    setBusyAction("discard");
    try {
      // discard 只还原工作区,暂存区里的改动要先退回来,否则会跟着
      // checkout 一起被带到目标分支上。
      const staged = (await native.gitStatus(repoRoot)).changedFiles
        .filter((f) => f.staged)
        .map((f) => f.path);
      if (staged.length > 0) {
        await native.gitUnstage(repoRoot, staged);
      }
      // 退完暂存区重新分类:刚 unstage 的新增文件现在算 untracked
      const status = await native.gitStatus(repoRoot);
      await native.gitDiscard(
        repoRoot,
        status.changedFiles.map((f) => ({
          path: f.path,
          untracked: f.untracked,
        })),
      );
      await native.gitCheckoutBranch(repoRoot, target.branch);
      setPendingSwitch(null);
      setCommitMsg("");
      window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
    } catch (e) {
      toast.error(String(e));
    } finally {
      checkoutInFlight.current = false;
      setBusyAction(null);
    }
  }, [repoRoot, pendingSwitch]);

  if (!repo) return null;

  if (bare) {
    return (
      <span
        title={`当前分支 · ${repo.branch}`}
        className={cn(
          "flex min-w-0 shrink items-center gap-1 text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{repo.branch}</span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={checkingOut}
        title={`当前分支 · ${repo.branch} · 点击切换`}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-w-0 shrink cursor-pointer items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-70",
          className,
        )}
      >
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0"
        />
        <span className="truncate">{repo.branch}</span>
      </button>

      {/* 分支列表用居中 Dialog 而不是贴着触发器的下拉:列表高到 2/3 屏
          时,下拉会盖到触发点旁边的按钮上造成误触;居中弹层跟底栏隔开。
          宽度 w-max 随列数自适应,顶到 90vw 为止。 */}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* 尺寸固定,不随"有没有展开改动"变 —— 弹框一会儿宽一会儿窄,
            点两下分支就晕了。宽度让内容撑,顶到 90vw 为止 */}
        <DialogContent className="w-max max-w-[90vw] gap-4 sm:max-w-[90vw]">
          <DialogHeader className="items-center text-center sm:text-center">
            <DialogTitle className="text-lg">Git 仓库</DialogTitle>
            {/* 跟顶栏面包屑同一套写法:倒数第二段是产品,最后一段是工程,
                再带上当前分支 */}
            <DialogDescription className="flex items-center justify-center gap-1.5 text-sm">
              <span className="text-muted-foreground/80">
                {projectRoot?.split("/").slice(-2, -1)[0] ?? ""}
              </span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-semibold text-emerald-500">
                {projectRoot?.split("/").slice(-1)[0] ?? ""}
              </span>
              <HugeiconsIcon
                icon={GitBranchIcon}
                size={13}
                strokeWidth={1.75}
                className="ml-1 shrink-0 text-muted-foreground"
              />
              <span className="text-muted-foreground">{repo.branch}</span>
            </DialogDescription>
            <RepoUrlChip
              projectRoot={projectRoot}
              className="max-w-full font-mono text-[11px]"
            />
          </DialogHeader>
          {/* 常用操作钉在左上角(和右上角的关闭 X 对称);只作用于当前
              分支,右边看别的分支提交记录时就藏起来,免得会错意 */}
          {selected?.isHead && (
            // 右上角、关闭 X 左边 —— 跟 SourceTree 工具栏一个位置
            <div className="absolute top-4 right-14 flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={busyAction !== null}
                title="暂存并提交当前分支的全部改动"
                onClick={() => {
                  setCommitMsg("");
                  setCommitOnlyOpen(true);
                }}
                className="h-7 gap-1 px-2 text-xs"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle01Icon}
                  size={13}
                  strokeWidth={1.75}
                />
                提交
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={syncBusy !== null}
                title="git pull --ff-only(仅快进)"
                onClick={() => void runSync("pull")}
                className="h-7 gap-1 px-2 text-xs"
              >
                {syncBusy === "pull" ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={Download01Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                )}
                拉取
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={syncBusy !== null}
                title="git push"
                onClick={() => void runSync("push")}
                className="h-7 gap-1 px-2 text-xs"
              >
                {syncBusy === "push" ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    size={13}
                    strokeWidth={1.75}
                  />
                )}
                推送
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={syncBusy !== null}
                title="git fetch(只更新远程分支,不动工作区)"
                onClick={() => void runSync("fetch")}
                className="h-7 gap-1 px-2 text-xs"
              >
                {syncBusy === "fetch" ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={Download01Icon}
                    size={13}
                    strokeWidth={1.75}
                    className="opacity-60"
                  />
                )}
                抓取
              </Button>
            </div>
          )}
          {branches == null && listError == null ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              正在读取分支…
            </div>
          ) : listError ? (
            <div className="px-3 py-3 text-[11px] leading-snug text-destructive">
              {listError}
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 gap-4">
              {/* 左:分支单列列表。单击选中看提交记录,双击才切换 */}
              <div className="h-[72vh] w-72 shrink-0 overflow-y-auto pr-1">
                <div className="px-2 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/85 uppercase">
                  本地分支
                </div>
                {localBranches.map((b) => (
                  <ContextMenu key={b.name}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() =>
                          selectBranch({
                            display: b.name,
                            refName: b.name,
                            checkoutName: b.name,
                            isHead: b.isHead,
                          })
                        }
                        onDoubleClick={() => {
                          if (b.isHead || checkingOut) return;
                          if (b.kind === "worktree") {
                            // 分支同时只能被一个工作区 checkout,主工作区切不了
                            toast.error(
                              `${b.name} 已挂在 worktree 上,请直接打开对应目录使用`,
                            );
                            return;
                          }
                          void handleCheckout(b.name);
                        }}
                        className={cn(
                          "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-foreground/10",
                          selected?.refName === b.name && "bg-foreground/10",
                        )}
                      >
                        {b.isHead ? (
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            size={14}
                            strokeWidth={2}
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                        <span
                          className={cn(
                            "min-w-0 truncate",
                            b.isHead && "font-semibold text-emerald-500",
                          )}
                        >
                          {b.name}
                        </span>
                        {b.kind === "worktree" && (
                          <span
                            title={`这个分支检出在平行工作目录里${b.worktreePath ? `:\n${b.worktreePath}\n` : ","}一个分支同时只能被一个工作区检出,这里切不了 —— 去左侧项目树点对应的 worktree 子行使用`}
                            className="shrink-0 rounded bg-foreground/10 px-1 text-[9.5px] text-muted-foreground"
                          >
                            worktree
                          </span>
                        )}
                        {/* 相对上游的领先/落后,和 SourceTree 的 2↑ 一个意思 */}
                        {(b.ahead > 0 || b.behind > 0) && (
                          <span className="ml-auto shrink-0 rounded bg-foreground/10 px-1 text-[10px] text-muted-foreground tabular-nums">
                            {b.ahead > 0 && `${b.ahead}↑`}
                            {b.ahead > 0 && b.behind > 0 && " "}
                            {b.behind > 0 && `${b.behind}↓`}
                          </span>
                        )}
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-52 max-w-96">
                      {/* 双击也能切,但双击这事儿没人猜得到,菜单里给一份 */}
                      {!b.isHead && b.kind === "local" && (
                        <>
                          <ContextMenuItem
                            className="text-[12px]"
                            disabled={checkingOut}
                            onSelect={() => void handleCheckout(b.name)}
                          >
                            <span className="min-w-0 truncate">
                              检出 {b.name}
                            </span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                        </>
                      )}
                      {/* 合并方向最容易搞反,菜单上把两个分支名都写全 */}
                      {!b.isHead && currentBranch && (
                        <ContextMenuItem
                          className="text-[12px]"
                          onSelect={() =>
                            setPendingMerge({
                              ref: b.name,
                              display: `分支 ${b.name}`,
                            })
                          }
                        >
                          <span className="min-w-0 truncate">
                            合并 {b.name} 到 {currentBranch}…
                          </span>
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem
                        className="text-[12px]"
                        onSelect={() =>
                          setPendingNewBranch({
                            baseRef: b.name,
                            label: `分支 ${b.name}`,
                          })
                        }
                      >
                        基于此分支新建分支…
                      </ContextMenuItem>
                      {!inWorktree && (
                        <ContextMenuItem
                          className="text-[12px]"
                          onSelect={() =>
                            setPendingWorktree({
                              baseRef: b.name,
                              shortName: b.name,
                              label: `分支 ${b.name}`,
                            })
                          }
                        >
                          为此分支创建 worktree…
                        </ContextMenuItem>
                      )}
                      {/* 推到远端同名分支:不用先切过去,git 允许推没检出
                          的分支。没有上游会顺手建立跟踪 */}
                      <ContextMenuItem
                        className="text-[12px]"
                        disabled={pushingBranch !== null}
                        onSelect={() => void pushBranch(b.name)}
                      >
                        <span className="min-w-0 truncate">
                          推送到远端同名分支
                          {b.ahead > 0 ? `(${b.ahead} 个提交)` : ""}
                        </span>
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-[12px]"
                        onSelect={() => {
                          void copyToClipboard(b.name);
                          toast.success("已复制分支名", {
                            description: b.name,
                          });
                        }}
                      >
                        复制分支名
                      </ContextMenuItem>
                      {/* 当前分支和被 worktree 占用的分支 git 都不让删 */}
                      {b.kind === "local" && !b.isHead && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-[12px] text-destructive focus:text-destructive"
                            onSelect={() =>
                              setPendingDelete({
                                branch: b.name,
                                remote: null,
                                display: `本地分支 ${b.name}`,
                              })
                            }
                          >
                            删除分支…
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
                {/* 标签夹在本地分支和远程分支之间,平时只露最新那个
                    (找"线上是哪一版"十次有九次就是看它);点标题展开全部。
                    标签不给双击 checkout —— 那是 detached HEAD,要用就
                    右键基于它开分支/worktree。 */}
                {tags != null && tags.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setTagsExpanded((v) => !v)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/10"
                    >
                      <span className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/85 uppercase">
                        标签
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {tagsExpanded ? "收起" : "展开"}
                      </span>
                    </button>
                    {(tagsExpanded ? tags : tags.slice(0, 1)).map((t) => (
                      <ContextMenu key={t.name}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            title={`${t.name} · ${t.shortSha} · ${formatCommitTime(t.timestampSecs)}${t.subject ? `\n${t.subject}` : ""}`}
                            onClick={() =>
                              selectBranch({
                                display: t.name,
                                // 用全名限定,免得和同名分支撞上
                                refName: `refs/tags/${t.name}`,
                                checkoutName: t.name,
                                isHead: false,
                              })
                            }
                            className={cn(
                              "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-foreground/10",
                              selected?.refName === `refs/tags/${t.name}` &&
                                "bg-foreground/10",
                            )}
                          >
                            <span className="size-3.5 shrink-0" />
                            <span className="min-w-0 truncate">{t.name}</span>
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/70">
                              {t.shortSha}
                            </span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-52 max-w-96">
                          <ContextMenuItem
                            className="text-[12px]"
                            onSelect={() =>
                              setPendingNewBranch({
                                baseRef: `refs/tags/${t.name}`,
                                label: `标签 ${t.name}`,
                              })
                            }
                          >
                            基于此标签新建分支…
                          </ContextMenuItem>
                          {!inWorktree && (
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() =>
                                setPendingWorktree({
                                  baseRef: `refs/tags/${t.name}`,
                                  shortName: t.name,
                                  label: `标签 ${t.name}`,
                                })
                              }
                            >
                              为此标签创建 worktree…
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-[12px]"
                            onSelect={() => {
                              void copyToClipboard(t.name);
                              toast.success("已复制标签名", {
                                description: t.name,
                              });
                            }}
                          >
                            复制标签名
                          </ContextMenuItem>
                          <ContextMenuItem
                            className="text-[12px]"
                            onSelect={() => {
                              void copyToClipboard(t.sha);
                              toast.success("已复制标签指向的提交", {
                                description: t.sha,
                              });
                            }}
                          >
                            复制提交 SHA
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </>
                )}
                {remoteBranches.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/85 uppercase">
                      远程分支
                    </div>
                    {remoteBranches.map((b) => (
                      <ContextMenu key={b.name}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={() =>
                              selectBranch({
                                display: b.name,
                                refName: b.name,
                                checkoutName: remoteShortName(b.name),
                                isHead: false,
                              })
                            }
                            onDoubleClick={() => {
                              if (!checkingOut) {
                                void handleCheckout(remoteShortName(b.name));
                              }
                            }}
                            className={cn(
                              "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-foreground/10",
                              selected?.refName === b.name &&
                                "bg-foreground/10",
                            )}
                          >
                            <span className="size-3.5 shrink-0" />
                            <span className="min-w-0 truncate">{b.name}</span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-52 max-w-96">
                          {/* 检出远程分支 = 建一个跟踪它的同名本地分支;
                              本地已经有同名分支时 git 直接切过去 */}
                          <ContextMenuItem
                            className="text-[12px]"
                            disabled={checkingOut}
                            onSelect={() =>
                              void handleCheckout(remoteShortName(b.name))
                            }
                          >
                            <span className="min-w-0 truncate">
                              检出为本地分支 {remoteShortName(b.name)}
                            </span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          {currentBranch && (
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() =>
                                setPendingMerge({
                                  ref: b.name,
                                  display: `远程分支 ${b.name}`,
                                })
                              }
                            >
                              <span className="min-w-0 truncate">
                                合并 {b.name} 到 {currentBranch}…
                              </span>
                            </ContextMenuItem>
                          )}
                          <ContextMenuItem
                            className="text-[12px]"
                            onSelect={() =>
                              setPendingNewBranch({
                                baseRef: b.name,
                                label: `远程分支 ${b.name}`,
                              })
                            }
                          >
                            基于此分支新建分支…
                          </ContextMenuItem>
                          {!inWorktree && (
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() =>
                                setPendingWorktree({
                                  baseRef: b.name,
                                  shortName: remoteShortName(b.name),
                                  label: `远程分支 ${b.name}`,
                                })
                              }
                            >
                              为此分支创建 worktree…
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-[12px]"
                            onSelect={() => {
                              void copyToClipboard(b.name);
                              toast.success("已复制分支名", {
                                description: b.name,
                              });
                            }}
                          >
                            复制分支名
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            className="text-[12px] text-destructive focus:text-destructive"
                            onSelect={() =>
                              setPendingDelete({
                                branch: remoteShortName(b.name),
                                remote: b.name.split("/")[0] ?? "origin",
                                display: `远程分支 ${b.name}`,
                              })
                            }
                          >
                            删除远程分支…
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </>
                )}
              </div>
              {/* 右:上半提交记录,下半选中提交的改动(照 SourceTree 那套
                  上下分区 —— diff 通栏比挤在窄的第三栏里好读得多) */}
              <div className="flex h-[72vh] w-[64rem] min-w-0 flex-col border-l border-border pl-4">
                {/* 上:提交记录。开着改动区时让出下面一大半 */}
                <div
                  className={cn(
                    "flex min-h-0 flex-col",
                    openCommit ? "h-[38%]" : "flex-1",
                  )}
                >
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {/* 工作区有没提交的改动就顶一行上去(照 SourceTree 的
                        "Uncommitted changes"):点它下面看的是工作区 diff。
                        只在当前分支上有意义 —— 别的分支的提交记录跟工作区
                        不是一回事 */}
                    {selected?.isHead && (workingFiles?.length ?? 0) > 0 && (
                      // biome-ignore lint/a11y/useSemanticElements: 和下面的提交行结构保持一致
                      <div
                        role="button"
                        tabIndex={0}
                        title="点击查看工作区里还没提交的改动"
                        onClick={() => {
                          setWorkingOpen(true);
                          setWorkingFile(workingFiles?.[0] ?? null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setWorkingOpen(true);
                            setWorkingFile(workingFiles?.[0] ?? null);
                          }
                        }}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 border-b border-border/40 px-1 py-1.5 transition-colors hover:bg-foreground/[0.06]",
                          workingOpen && "sticky top-0 z-10 bg-popover",
                        )}
                      >
                        {/* 和下面的提交行对齐:那边最前面是时间列 */}
                        <span className="w-28 shrink-0 text-[10.5px] text-muted-foreground/50">
                          现在
                        </span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 break-words text-[12px] leading-snug font-medium",
                            workingOpen && "text-emerald-500/75",
                          )}
                        >
                          未提交的更改
                        </span>
                        <span className="shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {workingFiles?.length} 个文件
                        </span>
                        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/50">
                          ·
                        </span>
                      </div>
                    )}
                    {logError ? (
                      <div className="px-1 py-2 text-[11px] leading-snug text-destructive">
                        {logError}
                      </div>
                    ) : logEntries == null ? (
                      <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
                        <Spinner className="size-3" />
                        正在读取提交记录…
                      </div>
                    ) : logEntries.length === 0 ? (
                      <div className="px-1 py-2 text-[11px] text-muted-foreground">
                        没有提交记录
                      </div>
                    ) : (
                      logEntries.map((c) => (
                        <ContextMenu key={c.sha}>
                          <ContextMenuTrigger asChild>
                            {/* biome-ignore lint/a11y/useSemanticElements: 行里还要放右键菜单和多段文本,<button> 会把结构挤坏 */}
                            <div
                              role="button"
                              tabIndex={0}
                              title="点击查看这次提交改了什么"
                              onClick={() => {
                                setWorkingOpen(false);
                                setOpenCommit(c);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setWorkingOpen(false);
                                  setOpenCommit(c);
                                }
                              }}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 border-b border-border/40 px-1 py-1.5 transition-colors last:border-b-0 hover:bg-foreground/[0.06]",
                                // 选中的那条钉在列表顶上:列表一滚,下面
                                // 那片 diff 到底是哪个提交的就看不见了
                                !workingOpen &&
                                  openCommit?.sha === c.sha &&
                                  "sticky top-0 z-10 bg-popover",
                              )}
                            >
                              {/* 时间放最前面:按时间找提交比按说明找快,
                                  一列对齐了扫起来也省事 */}
                              <span className="w-28 shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                                {formatCommitTime(c.timestampSecs)}
                              </span>
                              {/* 说明完整显示,超长折行而不是截断。右边 diff
                                是哪条提交的,靠这行文字变绿来认 —— 比当前
                                分支那个绿淡一档,免得跟"你在这个分支上"
                                抢注意力 */}
                              <span
                                className={cn(
                                  "min-w-0 flex-1 break-words text-[12px] leading-snug",
                                  !workingOpen &&
                                    openCommit?.sha === c.sha &&
                                    "text-emerald-500/75",
                                )}
                              >
                                {c.subject}
                              </span>
                              {/* 这个提交上打了标签就摆出来 —— 找"哪一版发的"
                                全靠它,比翻左边标签列表快 */}
                              {c.tags.map((t) => (
                                <span
                                  key={t}
                                  title={`标签 ${t}`}
                                  className="max-w-40 shrink-0 truncate rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500"
                                >
                                  {t}
                                </span>
                              ))}
                              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                                {c.shortSha}
                              </span>
                              <span className="shrink-0 text-[10.5px] text-muted-foreground">
                                {c.author}
                              </span>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="min-w-52">
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() => setOpenCommit(c)}
                            >
                              查看改动…
                            </ContextMenuItem>
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() => {
                                void copyToClipboard(c.sha);
                                toast.success("已复制完整 SHA", {
                                  description: c.sha,
                                });
                              }}
                            >
                              复制 SHA
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() =>
                                setPendingNewBranch({
                                  baseRef: c.sha,
                                  label: `提交 ${c.shortSha}(${c.subject})`,
                                })
                              }
                            >
                              基于此提交新建分支…
                            </ContextMenuItem>
                            <ContextMenuItem
                              className="text-[12px]"
                              onSelect={() =>
                                setPendingWorktree({
                                  baseRef: c.sha,
                                  shortName: c.shortSha,
                                  label: `提交 ${c.shortSha}(${c.subject})`,
                                })
                              }
                            >
                              基于此提交创建 worktree…
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))
                    )}
                  </div>
                </div>
                {/* 下:选中的改动 —— 左文件清单+说明,右 diff,通栏铺开。
                    数据源可能是某个提交,也可能是工作区(未提交的更改) */}
                {(openCommit || workingOpen) && (
                  <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-border pt-2">
                    <div className="flex min-h-0 flex-1 gap-3">
                      <div className="flex w-72 shrink-0 flex-col">
                        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                          {changeRows == null ? (
                            <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
                              <Spinner className="size-3" />
                              正在读取改动…
                            </div>
                          ) : changeRowsError ? (
                            <div className="px-1 py-2 text-[11px] leading-snug text-destructive">
                              {changeRowsError}
                            </div>
                          ) : changeRows.length === 0 ? (
                            <div className="px-1 py-2 text-[11px] text-muted-foreground">
                              {workingOpen
                                ? "工作区没有未提交的改动"
                                : "这次提交没有文件改动(空提交或合并提交)"}
                            </div>
                          ) : (
                            changeRows.map((r) => (
                              <button
                                key={r.key}
                                type="button"
                                title={
                                  r.originalPath
                                    ? `${r.originalPath} → ${r.path}`
                                    : r.path
                                }
                                onClick={r.onPick}
                                className={cn(
                                  "flex w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-foreground/10",
                                  r.selected && "bg-foreground/10",
                                )}
                              >
                                <span className="flex w-full min-w-0 items-center gap-2">
                                  <span
                                    title={r.label}
                                    className={cn(
                                      "shrink-0 text-[10px] uppercase",
                                      r.tone,
                                    )}
                                  >
                                    {r.letter}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[12px]">
                                    {fileBasename(r.path)}
                                  </span>
                                  {/* 二进制没有行数可言,别摆 +0/−0 误导;
                                      工作区那份 git 没给行数,也不摆 */}
                                  {r.isBinary ? (
                                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                      binary
                                    </span>
                                  ) : r.added !== null || r.removed !== null ? (
                                    <span className="shrink-0 text-[10px] tabular-nums">
                                      {(r.added ?? 0) > 0 && (
                                        <span className="text-emerald-500">
                                          +{r.added}
                                        </span>
                                      )}
                                      {(r.added ?? 0) > 0 &&
                                        (r.removed ?? 0) > 0 &&
                                        " "}
                                      {(r.removed ?? 0) > 0 && (
                                        <span className="text-red-400">
                                          −{r.removed}
                                        </span>
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                                {/* 同名文件常见(不同模块的 build.gradle) */}
                                <span className="w-full truncate pl-5 text-[10.5px] text-muted-foreground/60">
                                  {r.path}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                        {/* 提交说明全文 + 元信息:摆在文件清单下面,和
                          SourceTree 一个位置。正文常有好几段,保留换行 */}
                        <div className="mt-2 max-h-[45%] shrink-0 overflow-y-auto border-t border-border pt-2 pr-1">
                          {workingOpen ? (
                            <div className="flex flex-col gap-1 text-[11.5px] text-muted-foreground">
                              <span className="font-medium text-foreground">
                                工作区未提交的改动
                              </span>
                              <span className="text-[10.5px]">
                                共 {workingFiles?.length ?? 0} 个文件 · 分支{" "}
                                {repo.branch}
                              </span>
                              <span className="text-[10.5px] text-muted-foreground/70">
                                要提交的话用左上角的「提交」按钮
                              </span>
                            </div>
                          ) : (
                            openCommit && (
                              <>
                                <div className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed">
                                  {commitMeta?.subject ?? openCommit.subject}
                                  {commitMeta?.body
                                    ? `\n\n${commitMeta.body}`
                                    : ""}
                                </div>
                                <div className="mt-2 flex flex-col gap-0.5 text-[10.5px] text-muted-foreground">
                                  <span className="flex gap-1.5">
                                    <span className="shrink-0 text-muted-foreground/60">
                                      提交
                                    </span>
                                    <button
                                      type="button"
                                      title="点击复制完整 SHA"
                                      onClick={() => {
                                        void copyToClipboard(openCommit.sha);
                                        toast.success("已复制完整 SHA", {
                                          description: openCommit.sha,
                                        });
                                      }}
                                      className="min-w-0 cursor-pointer truncate text-left font-mono hover:text-foreground hover:underline"
                                    >
                                      {openCommit.sha}
                                    </button>
                                  </span>
                                  {(commitMeta?.parents.length ?? 0) > 0 && (
                                    <span className="flex gap-1.5">
                                      <span className="shrink-0 text-muted-foreground/60">
                                        父级
                                      </span>
                                      <span className="min-w-0 truncate font-mono">
                                        {commitMeta?.parents
                                          .map((x) => x.slice(0, 7))
                                          .join(" ")}
                                      </span>
                                    </span>
                                  )}
                                  <span className="flex gap-1.5">
                                    <span className="shrink-0 text-muted-foreground/60">
                                      作者
                                    </span>
                                    <span className="min-w-0 truncate">
                                      {commitMeta
                                        ? `${commitMeta.author} <${commitMeta.authorEmail}>`
                                        : openCommit.author}
                                    </span>
                                  </span>
                                  <span className="flex gap-1.5">
                                    <span className="shrink-0 text-muted-foreground/60">
                                      日期
                                    </span>
                                    <span className="min-w-0 truncate">
                                      {formatCommitTime(
                                        openCommit.timestampSecs,
                                      )}
                                    </span>
                                  </span>
                                  {(commitMeta?.refs.length ?? 0) > 0 && (
                                    <span className="flex gap-1.5">
                                      <span className="shrink-0 text-muted-foreground/60">
                                        标签
                                      </span>
                                      <span className="min-w-0 break-words">
                                        {commitMeta?.refs.join(", ")}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </>
                            )
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden border-l border-border pl-3">
                        {diffSource ? (
                          <GitDiffPane
                            key={diffKey}
                            active
                            chipLabel={diffChipLabel}
                            hideRepoPath
                            source={diffSource}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                            {changeRows?.length ? "选个文件看改动" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {branches != null && (
            <div className="border-t border-border pt-3">
              <div className="mb-1 px-2 text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/85 uppercase">
                Worktree
              </div>
              {worktrees.map((w) => {
                const wtPath = w.worktreePath;
                return (
                  <div
                    key={wtPath ?? w.name}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] hover:bg-foreground/5"
                  >
                    <HugeiconsIcon
                      icon={GitBranchIcon}
                      size={12}
                      strokeWidth={1.75}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="max-w-48 shrink-0 truncate">{w.name}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70"
                      title={wtPath ?? ""}
                    >
                      {wtPath}
                    </span>
                    {wtPath && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => void revealInFinder(wtPath)}
                        >
                          打开目录
                        </Button>
                        <Button
                          variant={
                            wtRemoveArm === wtPath ? "destructive" : "ghost"
                          }
                          size="sm"
                          disabled={wtBusy}
                          className={cn(
                            "h-6 gap-1 px-2 text-[11px]",
                            wtRemoveArm !== wtPath &&
                              "text-destructive hover:text-destructive",
                          )}
                          onClick={() => {
                            if (wtRemoveArm === wtPath) {
                              void removeWorktree(wtPath);
                            } else {
                              setWtRemoveArm(wtPath);
                            }
                          }}
                        >
                          {wtBusy && wtRemoveArm === wtPath && (
                            <Spinner className="size-3" />
                          )}
                          {wtRemoveArm === wtPath ? "再点一次确认删除" : "删除"}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
              {worktrees.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  暂无 worktree · 右键分支或提交即可创建
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => {
          // 提交/推送进行中不许点蒙层关掉:半路关框状态就没人看着了
          if (!o && busyAction === null) setPendingSwitch(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">有未提交的更改</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              当前分支有 {pendingSwitch?.count}{" "}
              个文件的改动尚未提交。输入提交信息并提交后,将切换到「
              {pendingSwitch?.branch}」。
            </DialogDescription>
          </DialogHeader>
          <ChangedFilesPreview
            repoRoot={repoRoot}
            active={pendingSwitch !== null}
            onOpenFile={
              onOpenDiff && repoRoot != null
                ? (f) => {
                    onOpenDiff(diffInputFor(repoRoot, f));
                    setPendingSwitch(null);
                    setOpen(false);
                  }
                : undefined
            }
          />
          <Textarea
            autoFocus
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="提交信息"
            rows={3}
            disabled={busyAction !== null}
            className="text-[12px]"
          />
          <DialogFooter>
            <Button
              variant={discardArmed ? "destructive" : "ghost"}
              size="sm"
              disabled={busyAction !== null}
              onClick={() => {
                if (discardArmed) {
                  void discardAndSwitch();
                } else {
                  setDiscardArmed(true);
                }
              }}
              className={cn(
                "mr-auto gap-1 text-xs",
                !discardArmed && "text-destructive hover:text-destructive",
              )}
            >
              {busyAction === "discard" && <Spinner className="size-3" />}
              {discardArmed ? "再点一次确认丢弃" : "丢弃所有修改并切换"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyAction !== null}
              onClick={() => setPendingSwitch(null)}
              className="text-xs"
            >
              取消切换分支
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!commitMsg.trim() || busyAction !== null}
              onClick={() => void commitAndSwitch(true)}
              className="gap-1 text-xs"
            >
              {busyAction === "push" && <Spinner className="size-3" />}
              提交本地并推送
            </Button>
            <Button
              size="sm"
              disabled={!commitMsg.trim() || busyAction !== null}
              onClick={() => void commitAndSwitch(false)}
              className="gap-1 text-xs"
            >
              {busyAction === "local" && <Spinner className="size-3" />}
              提交本地
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingWorktree !== null}
        onOpenChange={(o) => {
          if (!o && !wtBusy) setPendingWorktree(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">创建 Worktree</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              将基于{pendingWorktree?.label} 新建分支并挂载到仓库的 .worktree/
              目录下,分支名:
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1">
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
              worktree_
            </span>
            <input
              autoFocus
              value={wtSuffix}
              onChange={(e) => setWtSuffix(e.target.value)}
              onKeyDown={async (e) => {
                e.stopPropagation();
                if (e.key === "Enter" && pendingWorktree && wtSuffix.trim()) {
                  const ok = await createWorktree(
                    pendingWorktree.baseRef,
                    wtSuffix.trim(),
                  );
                  if (ok) setPendingWorktree(null);
                }
              }}
              spellCheck={false}
              disabled={wtBusy}
              className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={wtBusy}
              onClick={() => setPendingWorktree(null)}
              className="text-xs"
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={wtBusy || !wtSuffix.trim()}
              onClick={async () => {
                if (!pendingWorktree) return;
                const ok = await createWorktree(
                  pendingWorktree.baseRef,
                  wtSuffix.trim(),
                );
                if (ok) setPendingWorktree(null);
              }}
              className="gap-1 text-xs"
            >
              {wtBusy && <Spinner className="size-3" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingNewBranch !== null}
        onOpenChange={(o) => {
          if (!o && !nbBusy) setPendingNewBranch(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">新建分支</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              将基于{pendingNewBranch?.label}{" "}
              创建新分支(只创建,不切换),输入分支名:
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={nbName}
            onChange={(e) => setNbName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void createNewBranch();
            }}
            placeholder="新分支名"
            spellCheck={false}
            disabled={nbBusy}
            className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={nbBusy}
              onClick={() => setPendingNewBranch(null)}
              className="text-xs"
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!nbName.trim() || nbBusy}
              onClick={() => void createNewBranch()}
              className="gap-1 text-xs"
            >
              {nbBusy && <Spinner className="size-3" />}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">删除分支</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {pendingDelete?.remote
                ? `将从远程仓库删除「${pendingDelete.remote}/${pendingDelete.branch}」,这会影响所有协作者,且无法撤销。`
                : `将删除本地分支「${pendingDelete?.branch}」,无法撤销。`}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="break-all text-[11px] leading-snug text-destructive">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteBusy}
              onClick={() => setPendingDelete(null)}
              className="text-xs"
            >
              取消
            </Button>
            {/* 本地分支有远程对应物时,给"一起删"的口子 */}
            {pendingDelete?.remote == null && deleteRemoteCounterpart && (
              <Button
                variant="outline"
                size="sm"
                disabled={deleteBusy}
                title={`同时删除 ${deleteRemoteCounterpart}/${pendingDelete?.branch},这会影响所有协作者,且无法撤销`}
                onClick={() => void deleteBranch(!!deleteError, true)}
                className="gap-1 text-xs text-destructive hover:text-destructive"
              >
                删除本地和远程
              </Button>
            )}
            {/* -d 因未合并被拒后,就地给出 -D 的口子 */}
            {pendingDelete?.remote == null && deleteError && (
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteBusy}
                onClick={() => void deleteBranch(true)}
                className="gap-1 text-xs"
              >
                强制删除(-D)
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteBusy}
              onClick={() => void deleteBranch(false)}
              className="gap-1 text-xs"
            >
              {deleteBusy && <Spinner className="size-3" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingMerge !== null}
        onOpenChange={(o) => {
          if (!o && !mergeBusy) setPendingMerge(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">合并分支</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              将把{pendingMerge?.display} 合并到当前分支「{repo?.branch ?? ""}
              」(git merge --no-edit)。
            </DialogDescription>
          </DialogHeader>
          {mergeError && (
            <div className="flex flex-col gap-1.5">
              <div className="break-all text-[11px] leading-snug text-destructive">
                {mergeError}
              </div>
              <div className="text-[11px] leading-snug text-muted-foreground">
                如果是冲突:去终端解决冲突后提交,或执行 git merge --abort
                放弃这次合并。
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={mergeBusy}
              onClick={() => setPendingMerge(null)}
              className="text-xs"
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={mergeBusy || !!mergeError}
              onClick={() => void mergeBranch()}
              className="gap-1 text-xs"
            >
              {mergeBusy && <Spinner className="size-3" />}
              合并
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={commitOnlyOpen}
        onOpenChange={(o) => {
          if (!o && busyAction === null) setCommitOnlyOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {amendMode ? "修改上次提交的说明" : "提交更改"}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {amendMode ? (
                <>
                  工作区没有改动,这里改的是「{repo?.branch ?? ""}
                  」上一条提交的说明(git commit --amend),不会动任何文件。
                  <br />
                  这条提交如果已经推送过,改完远端还是旧的 ——
                  需要强制推送才能覆盖,这里不会替你做。
                </>
              ) : (
                <>
                  将暂存并提交当前分支「{repo?.branch ?? ""}
                  」的全部改动,输入提交信息:
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="提交信息"
            rows={3}
            disabled={busyAction !== null}
            className="text-[12px]"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyAction !== null}
              onClick={() => setCommitOnlyOpen(false)}
              className="text-xs"
            >
              取消
            </Button>
            {/* 没改动可提交时不摆"提交并推送":那条路只会撞上
                "nothing to commit" 报错 */}
            {!amendMode && (
              <Button
                variant="outline"
                size="sm"
                disabled={!commitMsg.trim() || busyAction !== null}
                onClick={() => void commitOnly(true)}
                className="gap-1 text-xs"
              >
                {busyAction === "push" && <Spinner className="size-3" />}
                提交并推送
              </Button>
            )}
            <Button
              size="sm"
              disabled={!commitMsg.trim() || busyAction !== null}
              onClick={() =>
                amendMode ? void amendMessage() : void commitOnly(false)
              }
              className="gap-1 text-xs"
            >
              {busyAction === "local" && <Spinner className="size-3" />}
              {amendMode ? "保存说明" : "提交本地"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
