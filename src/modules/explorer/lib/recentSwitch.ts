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
};

export type RecentSwitchGroup = { folder: string; rows: RecentSwitchRow[] };

type State = {
  groups: RecentSwitchGroup[];
  active: string | null;
  open: (path: string) => void;
};

/** 切完工程让聊天输入框接住光标:新窗格的输入框听这个事件。 */
export const FOCUS_CHAT_INPUT_EVENT = "terax:focus-chat-input";

/**
 * 切工程后新窗格要过一会儿才挂好、露出来:隔几下各喊一次。早的那下可能
 * 落在还没藏起来的旧窗格里,后面几下会纠正到新的那个。
 */
export function focusChatInputSoon() {
  for (const ms of [60, 200, 500, 900]) {
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(FOCUS_CHAT_INPUT_EVENT, { detail: { done: false } }),
      );
    }, ms);
  }
}

export const useRecentSwitchStore = create<State>(() => ({
  groups: [],
  active: null,
  open: () => {},
}));
