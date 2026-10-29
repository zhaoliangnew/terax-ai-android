/**
 * 最近切过去的工程/worktree:切到哪个记哪个,新的在前,存本地。只用来给
 * "最近"里开着的终端排先后(开着的一多,真正在来回切的就那几个排最上)。
 */
const KEY = "terax.explorer.recentProjects";

/** 只用来给开着的终端排先后,多记一些也不会多显示。 */
export const RECENT_MAX = 50;

function normalize(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function loadRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 存不下就只影响这次会话
  }
}

/** 挪到最前面(没有就加),返回新列表;已经在最前面时原样返回。 */
export function touchRecentProject(list: string[], path: string): string[] {
  const key = normalize(path);
  if (list[0] === key) return list;
  const next = [key, ...list.filter((p) => p !== key)].slice(0, RECENT_MAX);
  save(next);
  return next;
}

/**
 * 行尾的灰字提示:同名工程很多(每个客户目录下都有 app_bind),
 * 只看名字分不出是哪家的 —— 工程给上一级目录名,worktree 给
 * "产品目录 / 主工程"(光给主工程名,还是不知道是哪个产品的)。
 */
export function recentProjectInfo(path: string): {
  name: string;
  hint: string;
  isWorktree: boolean;
  /** worktree 所属主工程的根目录(查分支用);普通工程为 null。 */
  mainRoot: string | null;
} {
  const parts = normalize(path).split(/[\\/]/);
  const name = parts[parts.length - 1] ?? path;
  const wt = parts.lastIndexOf(".worktree");
  if (wt > 0 && wt === parts.length - 2) {
    const hint = [parts[wt - 2], parts[wt - 1]].filter(Boolean).join(" / ");
    const mainRoot = parts.slice(0, wt).join("/");
    return { name, hint, isWorktree: true, mainRoot };
  }
  return {
    name,
    hint: parts[parts.length - 2] ?? "",
    isWorktree: false,
    mainRoot: null,
  };
}

/**
 * 合成和树一样的三层:目录 → 产品 → worktree。worktree 挂到它的主工程下,
 * 主工程挂到它的上一级目录下。每一层的先后都按组里最近用过的那条排(不按
 * 名字)。只用过 worktree、主工程本身没进最近的,也给主工程一行当组头 ——
 * 不然 worktree 孤零零的看不出是哪个产品。
 */
export function groupRecentProjects(list: readonly string[]): {
  folder: string;
  products: { root: string; worktrees: string[] }[];
}[] {
  const folders = new Map<string, Map<string, string[]>>();
  for (const p of list) {
    const { mainRoot } = recentProjectInfo(p);
    const root = mainRoot ?? normalize(p);
    const folder = root.replace(/[\\/][^\\/]*$/, "");
    const products = folders.get(folder) ?? new Map<string, string[]>();
    const wts = products.get(root) ?? [];
    if (mainRoot) wts.push(normalize(p));
    products.set(root, wts);
    folders.set(folder, products);
  }
  return [...folders].map(([folder, products]) => ({
    folder,
    products: [...products].map(([root, worktrees]) => ({ root, worktrees })),
  }));
}
