import type { QuickLink } from "./quickLinks";

const KEY = "terax.apifox.links";

/** 团队首页,菜单头上那颗"首页"按钮去这儿。 */
export const APIFOX_HOME =
  "https://app.apifox.com/main/teams/466048?tab=project";

/**
 * 组里天天开的两个项目,写死在代码里跟着版本走,不可改不可删 ——
 * 跟嵌入式组知识库、钉钉名单一个路子:改代码就对所有人生效,
 * 不会被谁机器上的旧副本盖住。自己要加的往下面 localStorage 那份加。
 */
export const DEFAULT_APIFOX_LINKS: QuickLink[] = [
  {
    id: "apifox-tengyun-custom",
    title: "腾云定制项目接口",
    url: "https://app.apifox.com/project/2582514",
  },
  {
    id: "apifox-tengyun-master",
    title: "腾云master",
    url: "https://app.apifox.com/project/4006543",
  },
];

const BUILTIN_IDS = new Set(DEFAULT_APIFOX_LINKS.map((l) => l.id));

export function isBuiltinApifoxLink(link: QuickLink): boolean {
  return BUILTIN_IDS.has(link.id);
}

/**
 * 自己攒的那部分。结构直接复用 QuickLink(用不上 kind),免得为一模一样的
 * {id,title,url} 再定义一个类型。
 */
export function loadCustomApifoxLinks(): QuickLink[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((l) => l?.id && l?.url && !BUILTIN_IDS.has(l.id));
  } catch {
    return [];
  }
}

/** 内置 + 自定义,界面按这个渲染。 */
export function loadApifoxLinks(): QuickLink[] {
  return [...DEFAULT_APIFOX_LINKS, ...loadCustomApifoxLinks()];
}

function saveCustom(links: QuickLink[]): QuickLink[] {
  localStorage.setItem(KEY, JSON.stringify(links));
  return loadApifoxLinks();
}

export function upsertApifoxLink(link: QuickLink): QuickLink[] {
  if (BUILTIN_IDS.has(link.id)) return loadApifoxLinks();
  const custom = loadCustomApifoxLinks();
  const i = custom.findIndex((l) => l.id === link.id);
  if (i >= 0) custom[i] = link;
  else custom.push(link);
  return saveCustom(custom);
}

export function removeApifoxLink(id: string): QuickLink[] {
  if (BUILTIN_IDS.has(id)) return loadApifoxLinks();
  return saveCustom(loadCustomApifoxLinks().filter((l) => l.id !== id));
}

export function moveApifoxLink(id: string, delta: number): QuickLink[] {
  if (BUILTIN_IDS.has(id)) return loadApifoxLinks();
  const custom = loadCustomApifoxLinks();
  const i = custom.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= custom.length) return loadApifoxLinks();
  [custom[i], custom[j]] = [custom[j], custom[i]];
  return saveCustom(custom);
}
