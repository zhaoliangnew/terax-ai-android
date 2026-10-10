import type { GitBranchEntry } from "@/modules/ai/lib/native";

const BINDINGS_KEY = "terax.yunxiao.workitemRepos.v1";
// 一条任务一行,攒久了也就几百条;再多就把最久没碰过的丢掉,免得无限涨
const MAX_BINDINGS = 500;

/** 云效工作项绑定的本地仓库。按 26 位工作项 id 存,id 不会变。 */
export type WorkitemRepoBinding = {
  /** 主仓库根目录,永远不是 .worktree 下的路径。 */
  repoRoot: string;
  /** 编号和标题只拿来显示。 */
  serialNumber: string;
  subject: string;
  projectId: string;
  category: "Req" | "Task";
  boundAt: number;
  launchedAt?: number;
  /** 最近一次开工所在的 worktree;直接在仓库里开工时没有。 */
  worktreePath?: string;
};

function normPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * worktree 路径还原成主仓库(和 App.tsx 面包屑同一条规则),
 * 顺带统一成正斜杠、去掉末尾斜杠。工程在大仓库子目录里时,任务
 * worktree 从 git 根建,开发目录是 .worktree/<名字>/<子目录>,还原成
 * 主仓库里同一个子目录。
 */
export function mainRepoRoot(path: string): string {
  const stripped = normPath(path);
  if (!stripped) return path.trim() ? "/" : "";
  const m = /^(.*)\/\.worktree\/[^/]+(\/.*)?$/.exec(stripped);
  return m?.[1] ? m[1] + (m[2] ?? "") : stripped;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 坏数据(手改过、旧版本写的)整条丢掉,不让一条坏记录拖垮整张表。 */
export function parseBindings(
  raw: string | null,
): Record<string, WorkitemRepoBinding> {
  if (!raw) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, WorkitemRepoBinding> = {};
  for (const [id, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!id || id === "__proto__") continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const repoRoot = mainRepoRoot(str(o.repoRoot));
    if (!repoRoot) continue;
    if (o.category !== "Req" && o.category !== "Task") continue;
    const b: WorkitemRepoBinding = {
      repoRoot,
      serialNumber: str(o.serialNumber),
      subject: str(o.subject),
      projectId: str(o.projectId),
      category: o.category,
      boundAt: num(o.boundAt) ?? 0,
    };
    const launchedAt = num(o.launchedAt);
    if (launchedAt !== undefined) b.launchedAt = launchedAt;
    const wt = normPath(str(o.worktreePath));
    if (wt) b.worktreePath = wt;
    out[id] = b;
  }
  return out;
}

function lastTouched(b: WorkitemRepoBinding): number {
  return Math.max(b.boundAt, b.launchedAt ?? 0);
}

function loadBindings(): Record<string, WorkitemRepoBinding> {
  try {
    return parseBindings(localStorage.getItem(BINDINGS_KEY));
  } catch {
    return {};
  }
}

function saveBindings(all: Record<string, WorkitemRepoBinding>): void {
  let entries = Object.entries(all);
  if (entries.length > MAX_BINDINGS) {
    entries = entries
      .sort((a, b) => lastTouched(b[1]) - lastTouched(a[1]))
      .slice(0, MAX_BINDINGS);
  }
  try {
    localStorage.setItem(
      BINDINGS_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // 存不下(隐私模式/配额满)就只是下次要重新选仓库,不值得打断开工
  }
}

export function getWorkitemRepo(id: string): WorkitemRepoBinding | null {
  return loadBindings()[id] ?? null;
}

export function setWorkitemRepo(
  id: string,
  b: WorkitemRepoBinding | null,
): void {
  if (!id) return;
  const all = loadBindings();
  const repoRoot = b ? mainRepoRoot(b.repoRoot) : "";
  if (b && repoRoot) all[id] = { ...b, repoRoot };
  else delete all[id];
  saveBindings(all);
}

/** 开工后记一笔:时间用来排「最近用过」,worktreePath 跟着这次开工的方式走。 */
export function markLaunched(id: string, worktreePath?: string): void {
  const all = loadBindings();
  const cur = all[id];
  if (!cur) return;
  const next: WorkitemRepoBinding = { ...cur, launchedAt: Date.now() };
  const wt = worktreePath ? normPath(worktreePath) : "";
  if (wt) next.worktreePath = wt;
  else delete next.worktreePath;
  all[id] = next;
  saveBindings(all);
}

/** 同一个云效项目下别的任务绑过的仓库,最近用过的在前。 */
export function recentReposForProject(projectId: string): string[] {
  if (!projectId) return [];
  const list = Object.values(loadBindings())
    .filter((b) => b.projectId === projectId)
    .sort((a, b) => lastTouched(b) - lastTouched(a));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    if (seen.has(b.repoRoot)) continue;
    seen.add(b.repoRoot);
    out.push(b.repoRoot);
  }
  return out;
}

function asciiSerial(serial: string): string {
  let s = serial
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/_{2,}/g, "_");
  // git 不收以 . 或 .lock 结尾的分支名
  while (/(\.lock|\.)$/i.test(s)) s = s.replace(/(\.lock|\.)$/i, "");
  return s || "task";
}

/** 标题能进分支名/目录名的样子:去掉【】和 git、路径不收的符号,最多 20 个字。 */
function titleSlug(subject: string): string {
  const s = subject
    .replace(/[【】[\]()()「」『』<>《》"'“”‘’]/g, "")
    // 字母(含中文)、数字、. _ - 以外的都当分隔符
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return [...s]
    .slice(0, 20)
    .join("")
    .replace(/[._-]+$/g, "");
}

/** 任务 worktree 分支名的公共前缀:worktree_<编号>。认任务只认这个。 */
export function taskBranchPrefix(serial: string): string {
  return `worktree_${asciiSerial(serial)}`;
}

/**
 * 任务 worktree 的分支名,也是 .worktree/ 下的目录名:worktree_<编号>_<标题>,
 * 一眼看得出是哪个需求。ascii=true(Windows)时只留编号:目录名跟着分支名
 * 走,中文路径在 Windows 上会让 AGP 拒绝编译。
 */
export function taskWorktreeBranch(
  serial: string,
  subject = "",
  ascii = false,
): string {
  const prefix = taskBranchPrefix(serial);
  const title = ascii ? "" : titleSlug(subject);
  return title ? `${prefix}_${title}` : prefix;
}

/**
 * 这个分支是不是这条任务的:worktree_<编号> 本身,或者 worktree_<编号>_ 开头
 * (标题在云效上改过,名字对不上也还是同一条任务)。
 */
export function isTaskBranch(name: string, serial: string): boolean {
  const prefix = taskBranchPrefix(serial);
  return name === prefix || name.startsWith(`${prefix}_`);
}

export type TaskBranchState =
  | { kind: "worktree"; path: string; branch: string }
  | { kind: "branch"; isHead: boolean; branch: string }
  | { kind: "none" };

/**
 * 在 gitListBranches 的结果里看这条任务的分支处在什么状态(按编号认,
 * 标题改过也算)。同名分支挂着 worktree 时列表里只剩 worktree 那一条
 * (Rust 侧去重时优先留它)。
 */
export function taskBranchState(
  branches: readonly GitBranchEntry[],
  serial: string,
): TaskBranchState {
  const wt = branches.find(
    (b) =>
      b.kind === "worktree" && isTaskBranch(b.name, serial) && b.worktreePath,
  );
  if (wt?.worktreePath) {
    return {
      kind: "worktree",
      path: normPath(wt.worktreePath),
      branch: wt.name,
    };
  }
  const local = branches.find(
    (b) => b.kind === "local" && isTaskBranch(b.name, serial),
  );
  if (local)
    return { kind: "branch", isHead: local.isHead, branch: local.name };
  return { kind: "none" };
}
