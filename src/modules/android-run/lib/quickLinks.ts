import { native } from "@/modules/ai/lib/native";
import { KNOWLEDGE_BASE_LINKS } from "./knowledgeBase";
import { openExternally, shellQuote } from "./openExternally";

const KEY = "terax.quickLinks";

/** 团队级固定入口(云效知识库、钉钉文档、看板…),跟具体工程无关,全局一份。 */
export type QuickLink = {
  id: string;
  title: string;
  url: string;
  /** 目录节点显示文件夹图标,文档节点显示文档图标;自定义入口不带。 */
  kind?: "folder" | "doc";
  /**
   * "app" = url 里存的是 .app 路径,点了唤应用;不填就是网址,浏览器打开。
   * 老数据没有这个字段,当网址处理 —— 收藏夹以前只能存网址。
   */
  target?: "app";
};

/** 点一下该干什么,由 target 决定。 */
export function openQuickLink(link: QuickLink): void {
  if (link.target === "app") {
    void native.shellBgSpawn(`open -a ${shellQuote(link.url)}`, null);
    return;
  }
  openExternally(link.url);
}

/**
 * /Applications 里装了什么。给收藏应用时挑用的 —— 手敲路径太容易错,
 * 而这个列表本来就是现成的(.app 就是个目录)。
 */
export async function listInstalledApps(): Promise<
  { name: string; path: string }[]
> {
  try {
    const entries = await native.readDir("/Applications");
    return entries
      .filter((e) => e.name.endsWith(".app"))
      .map((e) => ({
        name: e.name.replace(/\.app$/, ""),
        path: `/Applications/${e.name}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  } catch {
    return [];
  }
}

/**
 * 内置知识库目录固定在前,用户自己加的入口跟在后面。内置项不可增删排序 ——
 * 它跟着知识库走,知识库加了目录升级就带过来。localStorage 只存用户自己的。
 */
export function loadQuickLinks(): QuickLink[] {
  if (typeof localStorage === "undefined") return KNOWLEDGE_BASE_LINKS;
  let stored: QuickLink[] | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) stored = v;
    }
  } catch {
    stored = null;
  }
  if (stored === null) return KNOWLEDGE_BASE_LINKS;
  // 存量数据里可能混着内置项(早期版本会整份存下来),按 id 滤掉再拼。
  const builtinIds = new Set(KNOWLEDGE_BASE_LINKS.map((b) => b.id));
  const custom = stored.filter((l) => !builtinIds.has(l.id));
  return [...KNOWLEDGE_BASE_LINKS, ...custom];
}

/** 清掉自己加的入口,只剩内置知识库目录。 */
export function resetQuickLinks(): QuickLink[] {
  save([]);
  return KNOWLEDGE_BASE_LINKS;
}

function save(links: QuickLink[]): void {
  localStorage.setItem(KEY, JSON.stringify(links));
}

export function newLinkId(): string {
  return `ql-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function upsertQuickLink(link: QuickLink): QuickLink[] {
  const links = loadQuickLinks();
  const i = links.findIndex((l) => l.id === link.id);
  if (i >= 0) links[i] = link;
  else links.push(link);
  save(customOnly(links));
  return loadQuickLinks();
}

export function removeQuickLink(id: string): QuickLink[] {
  save(customOnly(loadQuickLinks().filter((l) => l.id !== id)));
  return loadQuickLinks();
}

/** 只有用户自己加的入口进 localStorage;内置项永远来自代码。 */
function customOnly(links: QuickLink[]): QuickLink[] {
  const builtinIds = new Set(KNOWLEDGE_BASE_LINKS.map((b) => b.id));
  return links.filter((l) => !builtinIds.has(l.id));
}

export function moveQuickLink(id: string, delta: number): QuickLink[] {
  // 只在"自己加的"这一段里挪,内置区不参与。
  const custom = customOnly(loadQuickLinks());
  const i = custom.findIndex((l) => l.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= custom.length) return loadQuickLinks();
  [custom[i], custom[j]] = [custom[j], custom[i]];
  save(custom);
  return loadQuickLinks();
}

/**
 * 从粘贴的文本里猜一个标题:钉钉文档这类地址本身没有可读信息,与其显示一串
 * 哈希,不如让用户自己填 —— 这里只在用户没填时兜底。
 */
export function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 24);
  }
}
