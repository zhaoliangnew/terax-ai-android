import { create } from "zustand";

/**
 * 左栏"最近"那份列表,共享给聊天输入框底栏的"最近"悬停菜单:打完字不用
 * 再把鼠标挪到左上角去切工程。左栏导航树负责往里写,别处只读。
 */
export type RecentSwitchRow = {
  path: string;
  name: string;
  branch: string | null;
  isWorktree: boolean;
  /** 和树里一样:产品 1,挂在产品下的 worktree 2。 */
  depth: 1 | 2;
  /** 最后一次切过去的时间(毫秒);重启恢复后还没切过的为 null。 */
  usedAt: number | null;
  /** 自己开着终端。只开了 worktree 的产品也会作为组头出现,这时为 false。 */
  opened: boolean;
};

export type RecentSwitchGroup = { folder: string; rows: RecentSwitchRow[] };

type State = {
  groups: RecentSwitchGroup[];
  /** 开着的工程按最近切换排(当前在最前):上一个/下一个按钮按这个顺序走。 */
  order: string[];
  active: string | null;
  open: (path: string) => void;
  /** 清空"最近"的使用记录(不关终端)。 */
  clear: () => void;
  /** 单个从"最近"里去掉(不关终端)。 */
  remove: (path: string) => void;
};

/**
 * 每个工程(按工程根)开着的窗格:终端的 pty id、窗格 id。App 汇总后写进来,
 * 输入框下面的最近项目用它算各项目的 AI 状态(命令行看 pty,聊天看窗格会话)。
 */
export const useProjectPanes = create<{
  ptyIds: Record<string, number[]>;
  leafIds: Record<string, number[]>;
}>(() => ({ ptyIds: {}, leafIds: {} }));

/** 切完工程让聊天输入框接住光标:新窗格的输入框听这个事件。 */
export const FOCUS_CHAT_INPUT_EVENT = "terax:focus-chat-input";

/**
 * 切工程后新窗格要过一会儿才挂好、露出来:隔几下各喊一次。早的那下可能
 * 落在还没藏起来的旧窗格里,后面几下会纠正到新的那个。
 */
export function focusChatInputSoon() {
  // 会话刚开始连时输入框要等状态变成"启动中"才出来,多等两下
  for (const ms of [60, 200, 500, 900, 1500]) {
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(FOCUS_CHAT_INPUT_EVENT, { detail: { done: false } }),
      );
    }, ms);
  }
}

export const useRecentSwitchStore = create<State>(() => ({
  groups: [],
  order: [],
  active: null,
  open: () => {},
  clear: () => {},
  remove: () => {},
}));
