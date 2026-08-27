/**
 * 工作区文件被改动(编辑器存盘等)。git 状态查询有节流,只靠窗口聚焦重查
 * 会让"只看改动文件"和提交列表停在旧结果上 —— 谁改了盘就广播一下。
 */
export const WORKTREE_CHANGED_EVENT = "terax:worktree-changed";

/**
 * 某些文件的改动被显式丢弃了(git checkout / 删未跟踪文件),detail 里带
 * 绝对路径。和上面那个泛化信号分开:丢弃的语义是"这个文件我不要了",
 * 编辑器里没保存的编辑也得跟着扔 —— 否则自动保存过一秒又把它写回去,
 * 看着就像丢弃没生效。
 */
export const WORKTREE_DISCARDED_EVENT = "terax:worktree-discarded";

export type WorktreeDiscardedDetail = {
  /** 绝对路径(尽力而为)。 */
  paths: string[];
  /** 仓库内相对路径 —— 绝对路径可能因为软链/规范化对不上,用它兜底匹配。 */
  relPaths: string[];
};
