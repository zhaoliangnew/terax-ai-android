import { native } from "@/modules/ai/lib/native";
import { useEffect, useMemo, useState } from "react";
import { GIT_BRANCH_CHANGED_EVENT } from "../BranchChip";

/** 挂在某个工程下的一个 worktree。 */
export type ProjectWorktree = {
  /** worktree 的目录绝对路径(<repo>/.worktree/worktree_xxx)。 */
  path: string;
  /** 目录名(worktree_xxx),树里显示用。 */
  name: string;
  /** checkout 的分支名。 */
  branch: string;
};

/** 一个已打开工程的 git 概况:当前分支 + 挂着的 worktree。 */
export type ProjectGitInfo = {
  branch: string | null;
  worktrees: ProjectWorktree[];
};

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/**
 * 每个已打开工程的 git 概况,给文件树用:行尾显示当前分支,工程下面
 * 挂 worktree 子行。
 *
 * 只查**开着终端 tab 的工程**:产品线下动辄上百个 app_*,全量跑 git 太贵;
 * 而看分支/切 worktree 的前提就是工程已经开着。跟着分支变更事件和窗口
 * 回前台刷新(应用内的切分支/增删 worktree 都会广播事件;在终端里手动
 * checkout 的,回来聚焦一下窗口就对上了)。
 */
export function useProjectGitInfo(
  projectRoots: ReadonlySet<string>,
): Record<string, ProjectGitInfo> {
  const [byProject, setByProject] = useState<Record<string, ProjectGitInfo>>(
    {},
  );

  // Set 的身份每次都变,换成排序串做依赖,内容没变就不重查
  const rootsKey = useMemo(
    () => [...projectRoots].sort().join("\n"),
    [projectRoots],
  );

  useEffect(() => {
    // worktree 自己也会被当成"已打开的工程",但别去查它:它的分支已经
    // 显示在主工程的 worktree 子行上;而且从 linked worktree 里
    // `git worktree list` 会把主检出也列出来,树里就套娃了。
    const roots = (rootsKey ? rootsKey.split("\n") : []).filter(
      (r) => !/\/\.worktree\/[^/]+$/.test(r),
    );
    if (roots.length === 0) {
      setByProject({});
      return;
    }
    let alive = true;
    const read = () => {
      void Promise.all(
        roots.map(async (root): Promise<[string, ProjectGitInfo]> => {
          try {
            const repo = await native.gitResolveRepo(root);
            if (!repo) return [root, { branch: null, worktrees: [] }];
            const res = await native.gitListBranches(repo.repoRoot);
            const worktrees = res.branches
              .filter((b) => b.kind === "worktree" && b.worktreePath)
              .map((b) => ({
                path: b.worktreePath as string,
                name: basename(b.worktreePath as string),
                branch: b.name,
              }));
            return [root, { branch: repo.branch ?? null, worktrees }];
          } catch {
            return [root, { branch: null, worktrees: [] }];
          }
        }),
      ).then((pairs) => {
        if (!alive) return;
        const next: Record<string, ProjectGitInfo> = {};
        for (const [root, info] of pairs) {
          if (info.branch || info.worktrees.length > 0) next[root] = info;
        }
        setByProject(next);
      });
    };
    read();
    window.addEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      window.removeEventListener(GIT_BRANCH_CHANGED_EVENT, read);
      window.removeEventListener("focus", read);
    };
  }, [rootsKey]);

  return byProject;
}
