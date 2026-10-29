import { create } from "zustand";

/**
 * 悬停弹层里产品的分组:每一栏是一个分组(可以起名,比如"秤""网关"),
 * 产品放在哪个分组、排第几由用户拖卡片定,固定不动 —— 不再按高度自动
 * 平衡分栏(那样一拖、一多个 worktree,卡片就被挤到别的栏,界面跳来跳去)。
 * 按目录记,每个客户目录各排各的。
 */
const KEY = "terax.explorer.productGroups";

export type ProductGroup = { title: string; names: string[] };

function load(): Record<string, ProductGroup[]> {
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

type State = {
  layouts: Record<string, ProductGroup[]>;
  setLayout: (folder: string, groups: ProductGroup[]) => void;
};

export const useProductGroups = create<State>((set, get) => ({
  layouts: load(),
  setLayout: (folder, groups) => {
    const layouts = { ...get().layouts, [folder]: groups };
    try {
      localStorage.setItem(KEY, JSON.stringify(layouts));
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ layouts });
  },
}));

/**
 * 实际要画的分组:没排过就用自动分好的那几栏;排过的照记下的来,已经不在
 * 目录里的产品去掉,新出现的(没进过任何分组)放进最后一个分组。
 */
export function resolveLayout(
  names: readonly string[],
  saved: readonly ProductGroup[] | undefined,
  auto: readonly (readonly string[])[],
): ProductGroup[] {
  if (!saved?.length) return auto.map((n) => ({ title: "", names: [...n] }));
  const known = new Set(names);
  const groups = saved.map((g) => ({
    title: g.title,
    names: g.names.filter((n) => known.has(n)),
  }));
  const placed = new Set(groups.flatMap((g) => g.names));
  const missing = names.filter((n) => !placed.has(n));
  groups[groups.length - 1].names.push(...missing);
  return groups;
}

/**
 * 把 name 挪到第 group 个分组:有 target 就插在它前面/后面(拖的时候那条
 * 蓝线在哪就放哪),没有就放到这个分组最后。
 */
export function moveToGroup(
  groups: readonly ProductGroup[],
  name: string,
  group: number,
  target: string | null,
  after: boolean,
): ProductGroup[] {
  const next = groups.map((g) => ({
    title: g.title,
    names: g.names.filter((n) => n !== name),
  }));
  const dest = next[group];
  if (!dest) return groups.map((g) => ({ ...g, names: [...g.names] }));
  const at = target ? dest.names.indexOf(target) : -1;
  if (at < 0) dest.names.push(name);
  else dest.names.splice(after ? at + 1 : at, 0, name);
  return next;
}

/** 把第 from 个分组挪到第 to 个分组的前面/后面(拖分组名左边的抓手)。 */
export function moveGroup(
  groups: readonly ProductGroup[],
  from: number,
  to: number,
  after: boolean,
): ProductGroup[] {
  const next = [...groups];
  if (!next[from] || !next[to] || from === to) return next;
  const [moved] = next.splice(from, 1);
  const at = next.indexOf(groups[to]);
  next.splice(after ? at + 1 : at, 0, moved);
  return next;
}

/**
 * 悬停时"平铺子目录"的目录(比如 workspace_5.0_项目:下面是一个个客户目录,
 * 每个只有一两个产品)。开了以后弹层按客户目录分块,把各家的产品一起铺开。
 * 右键目录开关,按目录记。
 */
const TILED_KEY = "terax.explorer.tiledFolders";

function loadTiled(): string[] {
  try {
    const raw = localStorage.getItem(TILED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export const useTiledFolders = create<{
  folders: string[];
  toggle: (folder: string) => void;
}>((set, get) => ({
  folders: loadTiled(),
  toggle: (folder) => {
    const cur = get().folders;
    const folders = cur.includes(folder)
      ? cur.filter((f) => f !== folder)
      : [...cur, folder];
    try {
      localStorage.setItem(TILED_KEY, JSON.stringify(folders));
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ folders });
  },
}));
