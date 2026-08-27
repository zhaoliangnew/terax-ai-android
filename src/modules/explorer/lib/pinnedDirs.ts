/**
 * 置顶的目录:工程列表动辄上百个,常用的那几个每次都要滚半天才找到。
 * 置顶的排在同级最前面,存本地(和"最近打开"不是一回事 —— 那个会被
 * 别的操作挤掉,这个只有手动才变)。
 */
const KEY = "terax.explorer.pinnedDirs";

/** 置顶集合变了:同一个窗口里可能有好几棵树,都要跟着重排。 */
export const PINNED_DIRS_CHANGED_EVENT = "terax:explorer-pinned-changed";

function normalize(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function loadPinnedDirs(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

export function isPinnedDir(path: string): boolean {
  return loadPinnedDirs().has(normalize(path));
}

/** 路径规范化成集合里的 key,判断"是否置顶"必须走它,别自己拼正则。 */
export function pinnedKey(path: string): string {
  return normalize(path);
}

/**
 * 明确设成置顶/不置顶(幂等)。
 *
 * 不用 toggle:菜单项的文案是按 React state 里的集合算的,toggle 则按
 * localStorage 当场再读一遍。两者只要有一帧不同步,就会出现"点了'取消置顶'
 * 结果提示'已置顶'"——按目标状态写就没这问题,重复点也不会翻来覆去。
 */
/** 上一次切换:同一个路径 300ms 内的重复调用直接忽略。见 togglePinnedDir。 */
let lastToggle = { key: "", at: 0 };

/**
 * 翻转置顶状态,返回翻转之后是不是置顶。
 *
 * 当前状态**当场从 localStorage 读**,不吃 React state —— 菜单项渲染时算出
 * 来的那个值可能已经过期一帧(刚在别处改过置顶),用它去判断就会出现"点
 * 置顶提示已取消置顶"。
 *
 * 另外挡一下重复触发:菜单的 onSelect 实测会连发两次,翻转两次等于没翻,
 * 还会把提示带反。同一路径 300ms 内的第二次调用直接返回当前状态。
 */
export function togglePinnedDir(path: string): boolean {
  const key = normalize(path);
  const now = performance.now();
  if (lastToggle.key === key && now - lastToggle.at < 300) {
    return loadPinnedDirs().has(key);
  }
  lastToggle = { key, at: now };
  const pinned = !loadPinnedDirs().has(key);
  setPinnedDir(key, pinned);
  return pinned;
}

export function setPinnedDir(path: string, pinned: boolean): void {
  const key = normalize(path);
  const set = loadPinnedDirs();
  if (pinned) set.add(key);
  else set.delete(key);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // 存不下就只影响这次会话,不该让操作本身失败
  }
  window.dispatchEvent(new Event(PINNED_DIRS_CHANGED_EVENT));
}
