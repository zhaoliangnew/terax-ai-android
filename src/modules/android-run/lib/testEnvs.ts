/**
 * 内网 dev / test 环境:地址是有规律的 `https://<环境名>.<域名>`,
 * 比如 `https://test12.xnzn.net`。所以不存一百条链接,名字现算。
 */

const RECENT_KEY = "terax.testEnvs.recent";

/** 内网域名。真换了就改这一行。 */
export const ENV_HOST = "xnzn.net";

/** dev01…dev50 / test01…test50。 */
export const ENV_COUNT = 50;

export type EnvKind = "dev" | "test";

export const ENV_KINDS: { kind: EnvKind; label: string }[] = [
  { kind: "dev", label: "开发 dev" },
  { kind: "test", label: "测试 test" },
];

/** `dev` + 7 → `dev07`。编号一律补两位,跟运维那边的命名对齐。 */
export function envName(kind: EnvKind, n: number): string {
  return `${kind}${String(n).padStart(2, "0")}`;
}

export function envUrl(name: string): string {
  return `https://${name}.${ENV_HOST}`;
}

/** 最近打开过的环境名,最新的在前。 */
export function loadRecentEnvs(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const RECENT_MAX = 10;

export function pushRecentEnv(name: string): string[] {
  const next = [name, ...loadRecentEnvs().filter((x) => x !== name)].slice(
    0,
    RECENT_MAX,
  );
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function clearRecentEnvs(): string[] {
  localStorage.removeItem(RECENT_KEY);
  return [];
}
