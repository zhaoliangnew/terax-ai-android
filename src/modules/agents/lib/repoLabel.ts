/**
 * 输入框上方要显示的目录、工程名和 worktree 名。worktree 放在主工程的
 * `.worktree/<名字>` 下,工程名取主工程的文件夹名,不是 worktree 自己的;
 * 目录是主工程的上一级(同名工程很多,得知道是哪家的)。
 */
export function repoLabel(repoRoot: string): {
  folder: string;
  project: string;
  worktree: string | null;
} {
  const root = repoRoot.replace(/\/+$/, "");
  const wt = /^(.*)\/\.worktree\/([^/]+)$/.exec(root);
  const main = wt ? wt[1] : root;
  const parent = main.slice(0, Math.max(main.lastIndexOf("/"), 0));
  return {
    folder: parent.slice(parent.lastIndexOf("/") + 1),
    project: main.slice(main.lastIndexOf("/") + 1),
    worktree: wt ? wt[2] : null,
  };
}
