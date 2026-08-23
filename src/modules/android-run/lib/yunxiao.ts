const LINKS_KEY = "terax.yunxiao.projectLinks";

/**
 * 云效「项目」对应的是产品线**目录**(比如 `0.2.0-标准版本`),不是单个仓库 ——
 * 底下那一堆 app_* 仓库共用一个云效项目。所以映射按目录存,并且向上继承:
 * 在产品线目录上配一次,里面每个工程都能直达。
 */
function loadLinks(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLinks(links: Record<string, string>): void {
  localStorage.setItem(LINKS_KEY, JSON.stringify(links));
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

export type ResolvedLink = {
  /** 实际存了链接的那个目录。 */
  dir: string;
  url: string;
};

/** 从 `startDir` 逐级向上找最近一个配过云效项目的目录。 */
export function resolveProjectLink(startDir: string): ResolvedLink | null {
  const links = loadLinks();
  let dir = startDir.replace(/\/+$/, "");
  while (dir.length > 1) {
    const url = links[dir];
    if (url) return { dir, url };
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getProjectLink(dir: string): string | null {
  return loadLinks()[dir.replace(/\/+$/, "")] ?? null;
}

export function setProjectLink(dir: string, url: string): void {
  const links = loadLinks();
  const key = dir.replace(/\/+$/, "");
  const v = url.trim();
  if (v) links[key] = v;
  else delete links[key];
  saveLinks(links);
}
