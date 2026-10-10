import { IS_WINDOWS } from "@/lib/platform";
import { type GitBranchEntry, native } from "@/modules/ai/lib/native";
import { GIT_BRANCH_CHANGED_EVENT } from "@/modules/android-run/BranchChip";
import { classifyProjectKind } from "@/modules/android-run/lib/adb";
import {
  getWorkitem,
  type Workitem,
  type WorkitemDetail,
  workitemUrl,
} from "@/modules/android-run/lib/codeupApi";
import {
  getWorkitemRepo,
  mainRepoRoot,
  recentReposForProject,
  taskBranchPrefix,
  taskBranchState,
  taskWorktreeBranch,
} from "@/modules/android-run/lib/workitemBinding";
import {
  buildWorkitemPrompt,
  type ChatAgentKind,
  descriptionIsEmpty,
} from "@/modules/android-run/lib/workitemPrompt";
import {
  getProjectLink,
  listProjectLinkDirs,
} from "@/modules/android-run/lib/yunxiao";
import { useAndroidRunStore } from "@/modules/android-run/store";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";

export { taskWorktreeBranch };

export type RepoCandidate = {
  path: string;
  name: string;
  group: "recent" | "current" | "product";
};

const SCAN_CONCURRENCY = 6;
// 选仓库面板每开一次都要列候选;产品目录下动辄上百个工程,短时间内别重扫
const SCAN_TTL_MS = 60_000;

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function normPath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

const scanCache = new Map<string, { at: number; paths: Promise<string[]> }>();

/** 产品目录下一层里是工程的子目录,按名字排序。 */
function scanProductDir(dir: string): Promise<string[]> {
  const hit = scanCache.get(dir);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.paths;
  const paths = (async () => {
    const entries = await native.readDir(dir);
    const children = entries
      .filter((e) => e.kind === "dir" || e.kind === "symlink")
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const kinds = await mapLimit(children, SCAN_CONCURRENCY, (name) =>
      classifyProjectKind(`${dir}/${name}`).catch(() => null),
    );
    return children.filter((_, i) => kinds[i]).map((n) => `${dir}/${n}`);
  })();
  scanCache.set(dir, { at: Date.now(), paths });
  // 失败的不缓存,下次打开面板还能重试
  paths.catch(() => {
    if (scanCache.get(dir)?.paths === paths) scanCache.delete(dir);
  });
  return paths;
}

/**
 * 给一条工作项挑仓库时的候选:同项目最近用过的、当前工程、绑了这个
 * 云效项目的产品目录下的工程。同一路径只出现一次,先到的分组为准。
 */
export async function listRepoCandidates(
  projectId: string,
): Promise<RepoCandidate[]> {
  const out: RepoCandidate[] = [];
  const seen = new Set<string>();
  const add = (path: string, group: RepoCandidate["group"]) => {
    const p = mainRepoRoot(path);
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, name: basename(p), group });
  };

  for (const p of recentReposForProject(projectId)) add(p, "recent");
  const current = useAndroidRunStore.getState().projectRoot;
  if (current) add(current, "current");

  const productDirs = projectId
    ? listProjectLinkDirs()
        .filter((d) => getProjectLink(d)?.id === projectId)
        .map(normPath)
        .filter(Boolean)
    : [];
  const scanned = await Promise.all(
    productDirs.map((d) => scanProductDir(d).catch(() => [] as string[])),
  );
  for (const paths of scanned) for (const p of paths) add(p, "product");
  return out;
}

const authorized = new Set<string>();

// 绑定的仓库可能从没在终端里开过;git 命令要求路径在授权根下面,
// 用户亲手选的仓库就补一次授权,和开终端时一样
async function authorizeOnce(path: string): Promise<void> {
  if (!path || authorized.has(path)) return;
  try {
    await native.workspaceAuthorize(path);
    authorized.add(path);
  } catch {
    // 授权不了就让后面的 git 调用自己报错,错误信息更具体
  }
}

function pathExists(path: string): Promise<boolean> {
  return invoke("fs_stat", { path, workspace: currentWorkspaceEnv() }).then(
    () => true,
    () => false,
  );
}

/** `dir` 当前检出的分支;不是 git 仓库、detached 或读不到时是 null。 */
export async function currentBranch(dir: string): Promise<string | null> {
  const d = normPath(dir);
  if (!d) return null;
  await authorizeOnce(mainRepoRoot(d));
  try {
    const repo = await native.gitResolveRepo(d);
    if (!repo || repo.isDetached || !repo.branch || repo.branch === "HEAD") {
      return null;
    }
    return repo.branch;
  } catch {
    return null;
  }
}

/**
 * 绑定的目录在 git 里的位置:top 是 git 根,sub 是绑定目录相对它的子路径
 * (安卓工程放在大仓库子目录里时不为空)。worktree 得从 git 根建,AI 的
 * 开发目录和 local.properties 却要落到 worktree 里对应的子目录。
 * 不是 git 仓库(或读不到)是 null。
 */
async function repoLayout(
  root: string,
): Promise<{ top: string; sub: string } | null> {
  await authorizeOnce(root);
  try {
    const repo = await native.gitResolveRepo(root);
    if (!repo?.repoRoot) return null;
    const top = normPath(repo.repoRoot);
    if (top === root) return { top, sub: "" };
    if (top && root.startsWith(`${top}/`)) {
      return { top, sub: root.slice(top.length + 1) };
    }
    // 路径写法对不上(软链接换算过之类),按绑定目录本身当仓库根,和以前一样
    return { top: root, sub: "" };
  } catch {
    return null;
  }
}

function withSub(path: string, sub: string): string {
  return sub ? `${path}/${sub}` : path;
}

export type TaskWorktreeProbe = {
  /** 绑定目录在 git 仓库里;不在就没法建 worktree。 */
  isRepo: boolean;
  /** 绑定目录当前的分支(detached / 读不到是 null)。 */
  branch: string | null;
  /**
   * 任务分支眼下的样子,决定点「开始开发」会怎么做:
   * none 没有 → 新建分支和 worktree;worktree 挂着、目录也在 → 复用;
   * missing 挂着但目录被删了 → 清掉旧记录再挂回;branch 分支在、没挂 →
   * 挂回(上面可能有之前的提交,不能新建也不能删);head 主仓库正切在
   * 这个分支上 → 同一分支没法再挂一份,只能在当前分支开发。
   */
  state: "none" | "worktree" | "missing" | "branch" | "head";
  /** AI 会在哪个目录开发:已有的,或者将要建出来的位置。 */
  devDir: string | null;
  /** 任务分支:已有的(标题改过也按编号认出来),或者将要新建的名字。 */
  taskBranch: string;
};

/** 新建任务分支用的名字;Windows 上只留编号(中文目录 AGP 编译不了)。 */
function plannedBranch(serial: string, subject: string): string {
  return taskWorktreeBranch(serial, subject, IS_WINDOWS);
}

/** 开工前看一眼任务分支和 worktree 的状态,只读不动。 */
export async function probeTaskWorktree(
  repoRoot: string,
  serial: string,
  subject = "",
): Promise<TaskWorktreeProbe> {
  const root = mainRepoRoot(repoRoot);
  const layout = root ? await repoLayout(root) : null;
  const fresh = plannedBranch(serial, subject);
  if (!layout) {
    return {
      isRepo: false,
      branch: null,
      state: "none",
      devDir: null,
      taskBranch: fresh,
    };
  }
  const { top, sub } = layout;
  const [branch, branches] = await Promise.all([
    currentBranch(root),
    native
      .gitListBranches(top)
      .then((r) => r.branches)
      .catch(() => [] as GitBranchEntry[]),
  ]);
  const st = taskBranchState(branches, serial);
  const taskBranch = st.kind === "none" ? fresh : st.branch;
  const planned = withSub(`${top}/.worktree/${taskBranch}`, sub);
  if (st.kind === "worktree") {
    return (await pathExists(st.path))
      ? {
          isRepo: true,
          branch,
          state: "worktree",
          devDir: withSub(st.path, sub),
          taskBranch,
        }
      : { isRepo: true, branch, state: "missing", devDir: planned, taskBranch };
  }
  if (st.kind === "branch") {
    return st.isHead
      ? { isRepo: true, branch, state: "head", devDir: null, taskBranch }
      : { isRepo: true, branch, state: "branch", devDir: planned, taskBranch };
  }
  return { isRepo: true, branch, state: "none", devDir: planned, taskBranch };
}

/**
 * 这条任务已经挂着的 worktree(里对应绑定目录的那一层)。没有、读不到
 * git、或者目录已经被手动删掉(git 里还挂着记录)都算没有,确认面板不该
 * 承诺"复用"一个打不开的目录。
 */
export async function findTaskWorktree(
  repoRoot: string,
  serial: string,
): Promise<string | null> {
  try {
    const p = await probeTaskWorktree(repoRoot, serial);
    return p.state === "worktree" ? p.devDir : null;
  } catch {
    return null;
  }
}

async function copyLocalProperties(from: string, to: string): Promise<void> {
  // SDK 路径之类的本机配置不进 git,新 worktree 里没有它 gradle 就同步不了
  try {
    const target = `${to}/local.properties`;
    if (await pathExists(target)) return;
    const src = await native.readFile(`${from}/local.properties`);
    if (src.kind !== "text") return;
    await native.writeFile(target, src.content);
  } catch {
    // 拷不过去不影响开工,大不了用户自己同步一次
  }
}

const ensuring = new Map<string, Promise<{ path: string; created: boolean }>>();

async function ensureTaskWorktreeOnce(
  root: string,
  serial: string,
  subject: string,
): Promise<{ path: string; created: boolean }> {
  const layout = await repoLayout(root);
  if (!layout) {
    throw new Error(
      `${basename(root)} 不是 git 仓库(或读不到 git),没法建 worktree。改选「直接在这个目录开发」。`,
    );
  }
  const { top, sub } = layout;
  let branches: GitBranchEntry[];
  try {
    branches = (await native.gitListBranches(top)).branches;
  } catch (e) {
    throw new Error(`读不到 ${basename(top)} 的 git 分支:${String(e)}`);
  }
  const st = taskBranchState(branches, serial);
  // 已有的就用它原来的名字(标题改过也认),没有才按 编号_标题 新建
  const branch =
    st.kind === "none" ? plannedBranch(serial, subject) : st.branch;
  let path: string;
  let created = true;
  if (st.kind === "worktree" && (await pathExists(st.path))) {
    path = st.path;
    created = false;
  } else if (st.kind === "branch" && st.isHead) {
    throw new Error(
      `仓库当前就在分支 ${branch} 上,同一个分支没法再挂一份 worktree,改选「在当前分支开发」。`,
    );
  } else if (st.kind !== "none") {
    // 分支还在(worktree 被删了、或目录没了只剩记录):上面可能有之前的提交,
    // 不能新建同名分支(Rust 侧会悄悄加 -2),更不能删,挂回去接着用
    try {
      path = normPath(await native.gitWorktreeAttach(top, branch));
    } catch (e) {
      throw new Error(`把分支 ${branch} 挂回 worktree 失败:${String(e)}`);
    }
  } else {
    const base = (await currentBranch(root)) ?? "HEAD";
    try {
      path = normPath(await native.gitWorktreeAdd(top, base, branch));
    } catch (e) {
      throw new Error(`创建 worktree 失败:${String(e)}`);
    }
  }
  // 子目录没进 git 时 worktree 里不会有它,退回 worktree 根
  const dev = withSub(path, sub);
  const devDir = sub && !(await pathExists(dev)) ? path : dev;
  if (created) {
    await copyLocalProperties(root, devDir);
    window.dispatchEvent(new Event(GIT_BRANCH_CHANGED_EVENT));
  }
  return { path: devDir, created };
}

/**
 * 任务专属 worktree:已有就复用,分支还在就挂回,都没有才基于主仓库
 * 当前分支新建 worktree_<编号>_<标题>(Windows 只留编号;认已有的只看
 * 编号,标题改过也能找回来)。返回的 path 是 AI 的开发目录(工程在
 * 大仓库子目录里时是 worktree 里对应的子目录)。连点两下只会建一个。
 */
export function ensureTaskWorktree(
  repoRoot: string,
  serial: string,
  subject = "",
): Promise<{ path: string; created: boolean }> {
  const root = mainRepoRoot(repoRoot);
  if (!root) return Promise.reject(new Error("没有选仓库"));
  const key = `${root}\n${taskBranchPrefix(serial)}`;
  const pending = ensuring.get(key);
  if (pending) return pending;
  const p = ensureTaskWorktreeOnce(root, serial, subject).finally(() =>
    ensuring.delete(key),
  );
  ensuring.set(key, p);
  return p;
}

/** 拉不到详情时拿列表里那条凑一个,至少标题、编号、状态还在。 */
function detailFromListItem(
  item: Workitem,
  project: { id: string; name: string },
): WorkitemDetail {
  return {
    ...item,
    description: "",
    formatType: "",
    parentId: "",
    workitemTypeId: "",
    workitemTypeName: "",
    categoryId: getWorkitemRepo(item.id)?.category ?? "",
    spaceId: project.id,
    spaceName: project.name,
  };
}

/**
 * 开工前的准备:拉详情(正文为空时再拉父需求)、读开发目录的分支、
 * 拼第一条消息。云效接口失败不拦着开工,只发标题和链接,degraded 为真。
 */
export async function prepareWorkitemLaunch(a: {
  orgId: string;
  token: string;
  item: Workitem;
  project: { id: string; name: string };
  devDir: string;
  worktree: boolean;
  agent: ChatAgentKind;
}): Promise<{ title: string; prompt: string; url: string; degraded: boolean }> {
  const [fetched, branch] = await Promise.all([
    getWorkitem(a.orgId, a.token, a.item.id).catch(() => null),
    currentBranch(a.devDir),
  ]);
  const detail = fetched ?? detailFromListItem(a.item, a.project);
  const url = workitemUrl(a.project.id, a.item.id, detail.categoryId);

  let parent: WorkitemDetail | null = null;
  // 和拼消息用同一条"空正文"规则:只有图片、空 <article> 都算空,要拉父需求
  if (fetched && descriptionIsEmpty(detail) && detail.parentId) {
    parent = await getWorkitem(a.orgId, a.token, detail.parentId).catch(
      () => null,
    );
  }

  const built = buildWorkitemPrompt({
    detail,
    parent,
    projectName: a.project.name,
    url,
    // 父需求可能挂在别的云效项目下,链接按它自己的项目拼
    parentUrl: parent
      ? workitemUrl(
          parent.spaceId || a.project.id,
          parent.id,
          parent.categoryId,
        )
      : undefined,
    devDir: normPath(a.devDir),
    branch,
    worktree: a.worktree,
    agent: a.agent,
  });
  return {
    title: built.title,
    prompt: built.prompt,
    url,
    degraded: built.degraded || !fetched,
  };
}
