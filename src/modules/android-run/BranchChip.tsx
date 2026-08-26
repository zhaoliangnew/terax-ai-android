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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type GitBranchEntry,
  type GitChangedFile,
  type GitLogEntry,
  native,
} from "@/modules/ai/lib/native";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
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

/** 提交弹框里的改动预览:多少个文件、分别是哪些。 */
function ChangedFilesPreview({
  repoRoot,
  active,
}: {
  repoRoot: string | null;
  active: boolean;
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
              <div key={f.path} className="flex items-center gap-2">
                {/* w-16 才装得下 "Untracked";再窄就溢出和路径粘成一串 */}
                <span className="w-16 shrink-0 truncate text-muted-foreground/70">
                  {f.statusLabel}
                </span>
                <span className="min-w-0 flex-1 truncate" title={f.path}>
                  {f.path}
                </span>
              </div>
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
};

/**
 * 分支名。没有 git 仓库就什么都不画,不占位置。
 *
 * 非 bare 时点击弹本地分支列表,选中即 checkout;工作区有未提交改动就
 * 弹框拦下 —— 带着脏文件 checkout 成功与否全看运气,失败一半还会把人
 * 留在半切换状态,不如一开始就要求先提交。
 */
export function BranchChip({ projectRoot, className, bare }: Props) {
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
  const [discardArmed, setDiscardArmed] = useState(false);
  // worktree 区:进行中的操作、待二次确认删除的路径
  const [wtBusy, setWtBusy] = useState(false);
  const [wtRemoveArm, setWtRemoveArm] = useState<string | null>(null);
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
  const [syncBusy, setSyncBusy] = useState<"pull" | "push" | null>(null);
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

  // 被 worktree 占用的分支也算本地分支,一并列出来(带标记);
  // 排除 worktree 里 detached 的假名目
  const localBranches = useMemo(
    () =>
      branches?.filter(
        (b) => b.kind === "local" || (b.kind === "worktree" && !b.isDetached),
      ) ?? [],
    [branches],
  );
  // 已经有同名本地分支的远程分支不再列一遍;选中远程分支时用短名
  // checkout,git 会自动建出跟踪它的本地分支。
  const remoteBranches = useMemo(() => {
    if (!branches) return [];
    const localNames = new Set(localBranches.map((b) => b.name));
    return branches.filter(
      (b) => b.kind === "remote" && !localNames.has(remoteShortName(b.name)),
    );
  }, [branches, localBranches]);
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
    async (action: "pull" | "push") => {
      if (!repoRoot || syncBusy) return;
      setSyncBusy(action);
      try {
        if (action === "pull") {
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

  const deleteBranch = useCallback(
    async (force: boolean) => {
      const target = pendingDelete;
      if (!repoRoot || !target || deleteBusy) return;
      setDeleteBusy(true);
      setDeleteError(null);
      try {
        await native.gitDeleteBranch(repoRoot, target.branch, {
          remote: target.remote ?? undefined,
          force,
        });
        toast.success(`已删除${target.display}`);
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
    [repoRoot, pendingDelete, deleteBusy],
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
  useEffect(() => {
    if (!open || !repoRoot || !selectedRef) return;
    let alive = true;
    setLogEntries(null);
    setLogError(null);
    native
      .gitLog(repoRoot, { limit: 50, refName: selectedRef })
      .then((r) => {
        if (alive) setLogEntries(r);
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
    [repoRoot, wtBusy],
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
          setDiscardArmed(false);
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
    [repoRoot],
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
            <div className="absolute top-4 left-5 flex items-center gap-1.5">
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
            <div className="flex min-h-0 gap-4">
              {/* 左:分支单列列表。单击选中看提交记录,双击才切换 */}
              <div className="h-[60vh] w-72 shrink-0 overflow-y-auto pr-1">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[10.5px] font-semibold tracking-[0.12em] text-muted-foreground/85 uppercase">
                    本地分支
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    单击看提交 · 双击切换
                  </span>
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
              {/* 右:选中分支的提交记录 */}
              <div className="flex h-[60vh] w-[44rem] min-w-0 flex-col border-l border-border pl-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[12px] font-semibold">
                    提交记录 · {selected?.display ?? ""}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
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
                          <div className="flex items-center gap-2 border-b border-border/40 px-1 py-1.5 last:border-b-0">
                            {/* 说明完整显示,超长折行而不是截断 */}
                            <span className="min-w-0 flex-1 break-words text-[12px] leading-snug">
                              {c.subject}
                            </span>
                            <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                              {c.shortSha}
                            </span>
                            <span className="shrink-0 text-[10.5px] text-muted-foreground">
                              {c.author}
                            </span>
                            <span className="shrink-0 text-[10.5px] text-muted-foreground">
                              {formatCommitTime(c.timestampSecs)}
                            </span>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-52">
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
            <DialogTitle className="text-sm">提交更改</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              将暂存并提交当前分支「{repo?.branch ?? ""}
              」的全部改动,输入提交信息:
            </DialogDescription>
          </DialogHeader>
          <ChangedFilesPreview repoRoot={repoRoot} active={commitOnlyOpen} />
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
            <Button
              size="sm"
              disabled={!commitMsg.trim() || busyAction !== null}
              onClick={() => void commitOnly(false)}
              className="gap-1 text-xs"
            >
              {busyAction === "local" && <Spinner className="size-3" />}
              提交本地
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * 底栏右下角的快速提交入口:弹框输入提交信息,暂存当前分支的全部
 * 改动后提交,可选提交并推送。和 Git 仓库弹框里的"提交"同一套行为。
 */
export function QuickCommitButton({
  projectRoot,
  changedCount = 0,
  className,
}: {
  projectRoot: string | null;
  /** 未提交的变更文件数,>0 时在按钮上挂个角标 —— 一眼知道有没有账没结。 */
  changedCount?: number;
  className?: string;
}) {
  const repo = useProjectRepo(projectRoot);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"local" | "push" | null>(null);

  const commit = useCallback(
    async (push: boolean) => {
      const message = msg.trim();
      if (!repo || !message || busy) return;
      setBusy(push ? "push" : "local");
      try {
        const status = await native.gitStatus(repo.repoRoot);
        if (status.changedFiles.length === 0) {
          toast.info("没有需要提交的改动");
          setOpen(false);
          return;
        }
        // 重命名要把旧路径也 add 进去,否则旧文件的删除留在工作区
        const paths = status.changedFiles.flatMap((f) =>
          f.originalPath ? [f.path, f.originalPath] : [f.path],
        );
        await native.gitStage(repo.repoRoot, paths);
        await native.gitCommit(repo.repoRoot, message);
        if (push) await native.gitPush(repo.repoRoot);
        toast.success(push ? "已提交并推送" : "已提交到本地");
        setOpen(false);
        setMsg("");
        window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
      } catch (e) {
        toast.error(String(e));
      } finally {
        setBusy(null);
      }
    },
    [repo, msg, busy],
  );

  if (!repo) return null;
  return (
    // 挂在"提交"按钮上往上弹,跟底栏其他浮层一路风格 —— 居中大弹窗离
    // 按钮太远,视线要跳一大段。modal:点外部只关浮层,不穿透误点。
    <Popover
      modal
      open={open}
      onOpenChange={(o) => {
        if (!o && busy !== null) return; // 提交跑一半不许关
        setOpen(o);
      }}
    >
      <PopoverAnchor asChild>
        <Button
          variant="ghost"
          size="sm"
          title={
            changedCount > 0
              ? `${changedCount} 个文件有未提交的改动`
              : "暂存并提交当前分支的全部改动"
          }
          onClick={() => {
            setMsg("");
            setOpen((v) => !v);
          }}
          className={cn("h-7 gap-1 px-2 text-xs", className)}
        >
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            size={13}
            strokeWidth={1.75}
          />
          提交
          {changedCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
              {changedCount > 99 ? "99+" : changedCount}
            </span>
          )}
        </Button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        collisionPadding={8}
        // 焦点直接给提交信息输入框(Textarea 自己带 autoFocus)
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">提交更改</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            将暂存并提交当前分支「{repo.branch}」的全部改动,输入提交信息:
          </span>
        </div>
        <ChangedFilesPreview repoRoot={repo.repoRoot} active={open} />
        <Textarea
          // biome-ignore lint/a11y/noAutofocus: 打开就是为了输提交信息
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="提交信息"
          rows={3}
          disabled={busy !== null}
          className="text-[12px]"
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => setOpen(false)}
            className="text-xs"
          >
            取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!msg.trim() || busy !== null}
            onClick={() => void commit(true)}
            className="gap-1 text-xs"
          >
            {busy === "push" && <Spinner className="size-3" />}
            提交并推送
          </Button>
          <Button
            size="sm"
            disabled={!msg.trim() || busy !== null}
            onClick={() => void commit(false)}
            className="gap-1 text-xs"
          >
            {busy === "local" && <Spinner className="size-3" />}
            提交本地
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
