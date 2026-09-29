const KEY = "terax.web.recent";
const MAX = 12;

export type RecentSite = { url: string; title: string };

/** 新标签页"最近访问"那一栏:打开过的网页,新的在前,同一个网址只留一条。 */
export function loadRecentSites(): RecentSite[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((s) => s && typeof s.url === "string")
      : [];
  } catch {
    return [];
  }
}

function save(list: RecentSite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

/** 页面打开了:挪到最前面(标题先用网址,等标题出来再补)。 */
export function recordVisit(url: string) {
  if (!/^https?:/i.test(url)) return;
  const list = loadRecentSites();
  const prev = list.find((s) => s.url === url);
  save([
    { url, title: prev?.title || url },
    ...list.filter((s) => s.url !== url),
  ]);
}

export function recordTitle(url: string, title: string) {
  if (!title) return;
  const list = loadRecentSites();
  if (!list.some((s) => s.url === url)) return;
  save(list.map((s) => (s.url === url ? { ...s, title } : s)));
}

export function removeRecentSite(url: string): RecentSite[] {
  const next = loadRecentSites().filter((s) => s.url !== url);
  save(next);
  return next;
}
