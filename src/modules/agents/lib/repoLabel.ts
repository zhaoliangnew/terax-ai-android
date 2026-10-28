/**
 * 输入框上方要显示的工程名和 worktree 名。worktree 放在主工程的
 * `.worktree/<名字>` 下,工程名取主工程的文件夹名,不是 worktree 自己的。
 */
export function repoLabel(repoRoot: string): {
  project: string;
  worktree: string | null;
} {
  const root = repoRoot.replace(/\/+$/, "");
  const wt = /^(.*)\/\.worktree\/([^/]+)$/.exec(root);
  const main = wt ? wt[1] : root;
  return {
    project: main.slice(main.lastIndexOf("/") + 1),
    worktree: wt ? wt[2] : null,
  };
}
