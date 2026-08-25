const PROJECT_LINKS_KEY = "terax.yunxiao.projectLinks.v2";

/** 目录绑定的云效项目。存 id + 名字,名字只是拿来显示,跳转靠 id。 */
export type LinkedProject = { id: string; name: string };

/**
 * 云效「项目」对应产品线**目录**(比如 `0.2.0-标准版本`),不是单个仓库 ——
 * 底下那一堆 app_* 工程共用一个云效项目。所以按目录存,并且向上继承:
 * 在产品线目录上绑一次,里面每个工程都能直达。
 */
function loadProjectLinks(): Record<string, LinkedProject> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROJECT_LINKS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== "object") return {};
    return obj as Record<string, LinkedProject>;
  } catch {
    return {};
  }
}

function saveProjectLinks(links: Record<string, LinkedProject>): void {
  localStorage.setItem(PROJECT_LINKS_KEY, JSON.stringify(links));
}

export function getProjectLink(dir: string): LinkedProject | null {
  return loadProjectLinks()[dir.replace(/\/+$/, "")] ?? null;
}

export function setProjectLink(dir: string, link: LinkedProject | null): void {
  const links = loadProjectLinks();
  const key = dir.replace(/\/+$/, "");
  if (link?.id) links[key] = link;
  else delete links[key];
  saveProjectLinks(links);
}

/** 所有绑过云效项目的目录,给文件树标云图标用。 */
export function listProjectLinkDirs(): string[] {
  return Object.keys(loadProjectLinks());
}

/** 从 `startDir` 逐级向上找最近一个绑过云效项目的目录。 */
export function resolveProjectLink(
  startDir: string,
): { dir: string; link: LinkedProject } | null {
  const links = loadProjectLinks();
  let dir = startDir.replace(/\/+$/, "");
  while (dir.length > 1) {
    const link = links[dir];
    if (link) return { dir, link };
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

const TASK_LINKS_KEY = "terax.yunxiao.taskLinks";

/**
 * 「当前云效需求」跟着**工程**走,而且不继承 —— 它是"这个仓库我这会儿在做的
 * 那条需求",换需求就改。
 */
function loadTaskLinks(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(TASK_LINKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getTaskLink(projectRoot: string): string | null {
  return loadTaskLinks()[projectRoot.replace(/\/+$/, "")] ?? null;
}

export function setTaskLink(projectRoot: string, url: string): void {
  const links = loadTaskLinks();
  const key = projectRoot.replace(/\/+$/, "");
  const v = url.trim();
  if (v) links[key] = v;
  else delete links[key];
  localStorage.setItem(TASK_LINKS_KEY, JSON.stringify(links));
}

/**
 * `git@codeup.aliyun.com:<org>/<group>/<repo>.git` 或对应的 https 形式
 * → `<org>/<group>/<repo>`。不是 codeup 的仓库返回 null。
 */
export function codeupPathFromRemote(remote: string | null): string | null {
  if (!remote) return null;
  const r = remote.trim();
  const m =
    /^git@codeup\.aliyun\.com:(.+?)(?:\.git)?$/.exec(r) ??
    /^https?:\/\/codeup\.aliyun\.com\/(.+?)(?:\.git)?$/.exec(r);
  return m ? m[1] : null;
}

/** 仓库在 Codeup 上的网页地址(从 remote 推出来,不用配)。 */
export function codeupUrl(codeupPath: string): string {
  return `https://codeup.aliyun.com/${codeupPath}`;
}
