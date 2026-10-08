import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export type WebTabInfo = {
  id: string;
  /** 打开时的地址;之后地址栏自己接管,这里只作首帧用。 */
  url: string;
  title: string;
};

/** 每个工程(按根目录)各自的一组内嵌网页标签页。 */
type Store = {
  byRoot: Record<string, WebTabInfo[]>;
  add: (root: string, url: string) => string;
  /** AI 开的标签页:id 由 Rust 定(它要等这个 id 的网页出现)。 */
  addWithId: (root: string, id: string, url: string) => void;
  remove: (root: string, id: string) => void;
  setTitle: (root: string, id: string, title: string) => void;
};

/** 固定引用的空数组:给"这个工程还没网页 tab"的选择器用,别每次新建。 */
export const EMPTY_TABS: WebTabInfo[] = [];

// 原生网页视图比 app 自己的页面活得久:页面一刷新(开发时热重载、崩溃重
// 载),上一轮的网页还挂在窗口上、却没有 tab 管它。模块第一次加载就清一遍。
void invoke("web_close_all").catch(() => {});

let seq = 0;
/** 这一轮启动的前缀:刷新后编号从头来,label 也不会和残留的撞上。 */
const RUN = Date.now().toString(36);

export const useWebTabsStore = create<Store>((set) => ({
  byRoot: {},
  add: (root, url) => {
    seq += 1;
    const id = `web-${RUN}-${seq}`;
    set((s) => ({
      byRoot: {
        ...s.byRoot,
        [root]: [...(s.byRoot[root] ?? []), { id, url, title: "新标签页" }],
      },
    }));
    return id;
  },
  addWithId: (root, id, url) =>
    set((s) => {
      const list = s.byRoot[root] ?? [];
      if (list.some((t) => t.id === id)) return s;
      return {
        byRoot: {
          ...s.byRoot,
          [root]: [...list, { id, url, title: "新标签页" }],
        },
      };
    }),
  remove: (root, id) =>
    set((s) => ({
      byRoot: {
        ...s.byRoot,
        [root]: (s.byRoot[root] ?? []).filter((t) => t.id !== id),
      },
    })),
  setTitle: (root, id, title) =>
    set((s) => ({
      byRoot: {
        ...s.byRoot,
        [root]: (s.byRoot[root] ?? []).map((t) =>
          t.id === id ? { ...t, title } : t,
        ),
      },
    })),
}));

/** 让 App 把收起的右栏展开(AI 在内嵌浏览器里操作时要看得见)。 */
export const REVEAL_RIGHT_PANEL = "terax:reveal-right-panel";

/** 让右栏切到"仓库"tab(聊天输入框上方点分支名 / 未提交文件数)。 */
export const OPEN_REPO_TAB = "terax:open-repo-tab";

/**
 * 切到仓库 tab 后顺手弹出提交框的请求。仓库面板没打开过就还没挂载,
 * 收不到事件,所以先记在这里,面板露出来、工作区读到了再自己取走。
 */
export const pendingRepoCommit = { at: 0 };

/** 右栏没进任何工程时,网页标签页放在这一组里。 */
export const NO_PROJECT_ROOT = "(no-project)";

/** 请右栏新开一个网页标签页(比如聊天里点了 html 文件)。detail: { url } */
export const OPEN_IN_BROWSER = "terax:open-in-browser";

/** 在右栏内嵌浏览器里打开网址或本地 html 文件(传 file:// 或绝对路径)。 */
export function openInBrowser(urlOrPath: string) {
  const url = urlOrPath.startsWith("/") ? `file://${urlOrPath}` : urlOrPath;
  window.dispatchEvent(new CustomEvent(OPEN_IN_BROWSER, { detail: { url } }));
}
