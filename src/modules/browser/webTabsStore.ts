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
