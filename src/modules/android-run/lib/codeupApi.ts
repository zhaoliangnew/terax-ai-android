import { native } from "@/modules/ai/lib/native";
import { shellQuote } from "./openExternally";
import { codeupPathFromRemote } from "./yunxiao";

/**
 * 云效(Codeup)OpenAPI 的最小封装:创建代码库、搜索代码库。
 * 走 curl 而不是 fetch —— webview 里跨域直接被 CORS 拦死,curl 没这事。
 * 鉴权用个人访问令牌(x-yunxiao-token),本地保存。
 */

const DOMAIN = "openapi-rdc.aliyuncs.com";
const TOKEN_KEY = "yunxiao.openapi.token";
const ORG_KEY = "yunxiao.openapi.orgId";

export function getYunxiaoToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  return t?.trim() ? t.trim() : null;
}

export function setYunxiaoToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function getCodeupOrgId(): string | null {
  const v = localStorage.getItem(ORG_KEY);
  return v?.trim() ? v.trim() : null;
}

export function setCodeupOrgId(orgId: string): void {
  localStorage.setItem(ORG_KEY, orgId.trim());
}

/** 从任意 codeup 仓库地址里抠出组织 ID(路径第一段),顺手存起来。 */
export function stashOrgIdFromRemote(remote: string | null): string | null {
  const p = codeupPathFromRemote(remote);
  const org = p?.split("/")[0] ?? null;
  if (org) setCodeupOrgId(org);
  return org;
}

/** 个人访问令牌的申请页面。 */
export const TOKEN_HELP_URL =
  "https://account-devops.aliyun.com/settings/personalAccessToken";

const ROOT_GROUP_KEY = "yunxiao.openapi.rootGroup";

/** 把分组网页地址或路径归一成路径:https://codeup.aliyun.com/a/b → a/b。 */
export function normalizeRootGroupInput(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/codeup\.aliyun\.com\//, "")
    .replace(/\/+$/, "");
}

/** 云效仓库面板的根分组路径(含组织前缀,如 61dbcd…/device2.0)。 */
export function getRootGroupPath(): string | null {
  const v = localStorage.getItem(ROOT_GROUP_KEY);
  return v?.trim() ? v.trim() : null;
}

export function setRootGroupPath(input: string): void {
  localStorage.setItem(ROOT_GROUP_KEY, normalizeRootGroupInput(input));
}

async function call(
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  const parts = [
    "curl",
    "-sS",
    "-X",
    method,
    `https://${DOMAIN}${path}`,
    "-H",
    "Content-Type: application/json",
    "-H",
    `x-yunxiao-token: ${token}`,
    "-w",
    "\n__HTTP_%{http_code}__",
  ];
  if (body !== undefined) {
    parts.push("--data", JSON.stringify(body));
  }
  const out = await native.runCommand(
    parts.map(shellQuote).join(" "),
    null,
    30,
  );
  if (out.timed_out) {
    throw new Error("云效接口请求超时(30 秒)");
  }
  if (out.exit_code !== 0) {
    throw new Error(out.stderr || "云效接口请求失败");
  }
  const m = /\n__HTTP_(\d+)__\s*$/.exec(out.stdout);
  const status = m ? Number(m[1]) : 0;
  const raw = m ? out.stdout.slice(0, m.index) : out.stdout;
  let parsed: unknown = null;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (status >= 400 || status === 0) {
    const msg =
      (parsed &&
        typeof parsed === "object" &&
        ((parsed as Record<string, unknown>).errorMessage ??
          (parsed as Record<string, unknown>).message)) ||
      raw.slice(0, 200) ||
      `HTTP ${status}`;
    throw new Error(`云效接口报错(${status}):${String(msg)}`);
  }
  return parsed;
}

export type CodeupRepo = {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string;
  /**
   * 创建人的云效用户 ID,名字要拿成员列表换。
   * 注意:接口里同时有个 creatorId 字段,文档标注"无业务实际意义",
   * 真正的创建人是 creatorUid —— 别改回去。
   */
  creatorUid: string;
  lastActivityAt: string;
  /** 仓库大小,单位 MB;接口没给就是 null */
  repositorySize: number | null;
};

function parseRepo(r: Record<string, unknown>): CodeupRepo | null {
  const p = r.pathWithNamespace;
  if (typeof p !== "string") return null;
  return {
    id: Number(r.id),
    name: String(r.name ?? ""),
    pathWithNamespace: p,
    description: String(r.description ?? ""),
    creatorUid: r.creatorUid != null ? String(r.creatorUid) : "",
    lastActivityAt: String(r.lastActivityAt ?? r.updatedAt ?? ""),
    repositorySize: r.repositorySize != null ? Number(r.repositorySize) : null,
  };
}

/** 按关键字搜代码库(search 模糊匹配仓库路径,取前 100 条)。 */
export async function listRepositories(
  orgId: string,
  token: string,
  search: string,
): Promise<CodeupRepo[]> {
  const q = encodeURIComponent(search.trim());
  const res = await call(
    "GET",
    `/oapi/v1/codeup/organizations/${orgId}/repositories?page=1&perPage=100&search=${q}`,
    token,
  );
  const arr = Array.isArray(res)
    ? res
    : ((res as { result?: unknown[] } | null)?.result ?? []);
  return (arr as Record<string, unknown>[])
    .map(parseRepo)
    .filter((r): r is CodeupRepo => r !== null);
}

/**
 * 按路径关键字把匹配的仓库全部搜回来(分页,最多 5 页 × 100)。
 * 用根分组路径当关键字,就能一次拿到该分组子树下的所有仓库。
 */
export async function searchRepositoriesAll(
  orgId: string,
  token: string,
  search: string,
): Promise<CodeupRepo[]> {
  const q = encodeURIComponent(search.trim());
  const seen = new Set<string>();
  const out: CodeupRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await call(
      "GET",
      `/oapi/v1/codeup/organizations/${orgId}/repositories?page=${page}&perPage=100&search=${q}`,
      token,
    );
    const arr = Array.isArray(res)
      ? res
      : ((res as { result?: unknown[] } | null)?.result ?? []);
    if ((arr as unknown[]).length === 0) break;
    let fresh = 0;
    for (const r of arr as Record<string, unknown>[]) {
      const parsed = parseRepo(r);
      if (parsed && !seen.has(parsed.pathWithNamespace)) {
        seen.add(parsed.pathWithNamespace);
        fresh++;
        out.push(parsed);
      }
    }
    if (fresh === 0) break;
  }
  return out;
}

/** 私有(仅成员可见)/ 内部(组织内可见);云效代码库和代码组都用这两档。 */
export type CodeupVisibility = "private" | "internal";

/**
 * 创建代码库。path 可以带父分组(如 device2.0/jinma/app_x),
 * createParentPath=true 让云效自动补父目录。
 */
export async function createRepository(
  orgId: string,
  token: string,
  fullPath: string,
  visibility: CodeupVisibility = "private",
): Promise<void> {
  const segs = fullPath.split("/").filter(Boolean);
  const name = segs[segs.length - 1] ?? fullPath;
  await call(
    "POST",
    `/oapi/v1/codeup/organizations/${orgId}/repositories?createParentPath=true`,
    token,
    { name, path: fullPath, visibility },
  );
}

export type CodeupGroupCreated = {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string;
};

/**
 * 创建子代码组。parentId 是父组的数字 id(GroupNode.id / CodeupNamespace.id),
 * path 只填新组这一段(不带父路径),parentId 决定挂在哪。
 */
export async function createGroup(
  orgId: string,
  token: string,
  parentId: number,
  name: string,
  path: string,
  description: string,
  visibility: CodeupVisibility = "private",
): Promise<CodeupGroupCreated> {
  const res = await call(
    "POST",
    `/oapi/v1/codeup/organizations/${orgId}/groups`,
    token,
    { name, path, parentId, description: description || undefined, visibility },
  );
  const o = res as Record<string, unknown>;
  return {
    id: Number(o.id),
    name: String(o.name ?? name),
    pathWithNamespace: String(o.pathWithNamespace ?? o.path ?? path),
    description: String(o.description ?? description ?? ""),
  };
}

export type CodeupRepoFull = {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string;
};

/**
 * 全量拉组织内代码库(带描述)。服务端会把 perPage 压到自己的上限,
 * 不能按"不满一页就是最后一页"判断 —— 一直翻到空页为止,并按路径
 * 去重(防止翻页期间列表变动造成重复)。
 */
export async function listAllRepositories(
  orgId: string,
  token: string,
  onBatch?: (snapshot: CodeupRepoFull[]) => void,
): Promise<CodeupRepoFull[]> {
  const seen = new Set<string>();
  const out: CodeupRepoFull[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call(
      "GET",
      `/oapi/v1/codeup/organizations/${orgId}/repositories?page=${page}&perPage=100&orderBy=name&sort=asc`,
      token,
    );
    const arr = Array.isArray(res)
      ? res
      : ((res as { result?: unknown[] } | null)?.result ?? []);
    if ((arr as unknown[]).length === 0) break;
    let fresh = 0;
    for (const r of arr as Record<string, unknown>[]) {
      const p = r.pathWithNamespace;
      if (typeof p === "string" && !seen.has(p)) {
        seen.add(p);
        fresh++;
        out.push({
          id: Number(r.id),
          name: String(r.name ?? ""),
          pathWithNamespace: p,
          description: String(r.description ?? ""),
        });
      }
    }
    // 整页全是见过的,说明翻到头开始重复了
    if (fresh === 0) break;
    onBatch?.([...out]);
  }
  return out;
}

export type CodeupGroup = {
  pathWithNamespace: string;
  name: string;
  description: string;
};

/**
 * 拉代码组列表(要组的名称和描述)。这个接口文档不全,拉挂了就
 * 返回空数组,面板退化成"只按路径分组、组无描述",不影响主功能。
 */
export async function listGroups(
  orgId: string,
  token: string,
): Promise<CodeupGroup[]> {
  try {
    const out: CodeupGroup[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await call(
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/groups?page=${page}&perPage=100`,
        token,
      );
      const arr = Array.isArray(res)
        ? res
        : ((res as { result?: unknown[] } | null)?.result ?? []);
      for (const g of arr as Record<string, unknown>[]) {
        const p = g.pathWithNamespace ?? g.fullPath ?? g.path;
        if (typeof p === "string" && p) {
          out.push({
            pathWithNamespace: p,
            name: String(g.name ?? ""),
            description: String(g.description ?? ""),
          });
        }
      }
      if ((arr as unknown[]).length === 0) break;
    }
    return out;
  } catch {
    return [];
  }
}

export type CodeupNamespace = {
  id: number;
  name: string;
  pathWithNamespace: string;
  description: string;
};

/**
 * 查单个代码组的信息(namespaceId 支持完整路径)。路径是否带组织
 * 前缀文档没说死,两种都试;查不到返回 null,不抛错。
 */
export async function getNamespaceInfo(
  orgId: string,
  token: string,
  relPath: string,
): Promise<CodeupNamespace | null> {
  for (const candidate of [relPath, `${orgId}/${relPath}`]) {
    try {
      const res = await call(
        "GET",
        `/oapi/v1/codeup/organizations/${orgId}/namespaces/${encodeURIComponent(candidate)}`,
        token,
      );
      const o = res as Record<string, unknown> | null;
      if (o && o.id != null) {
        return {
          id: Number(o.id),
          name: String(o.name ?? ""),
          pathWithNamespace: String(
            o.pathWithNamespace ?? o.fullPath ?? o.path ?? relPath,
          ),
          description: String(o.description ?? ""),
        };
      }
    } catch {
      // 换下一种路径形式再试
    }
  }
  return null;
}

/** 列某个代码组下的直属代码库(ListGroupRepositories,一层一层读)。 */
export async function listGroupRepositories(
  orgId: string,
  token: string,
  groupId: number,
): Promise<CodeupRepo[]> {
  const seen = new Set<string>();
  const out: CodeupRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await call(
      "GET",
      `/oapi/v1/codeup/organizations/${orgId}/groups/${groupId}/repositories?page=${page}&perPage=100&includeSubgroups=false`,
      token,
    );
    const arr = Array.isArray(res)
      ? res
      : ((res as { result?: unknown[] } | null)?.result ?? []);
    if ((arr as unknown[]).length === 0) break;
    let fresh = 0;
    for (const r of arr as Record<string, unknown>[]) {
      const parsed = parseRepo(r);
      if (parsed && !seen.has(parsed.pathWithNamespace)) {
        seen.add(parsed.pathWithNamespace);
        fresh++;
        out.push(parsed);
      }
    }
    if (fresh === 0) break;
  }
  return out;
}

/** 单查一个代码库,补列表接口缺的字段(描述/创建人/活跃时间/大小)。 */
export async function getRepositoryInfo(
  orgId: string,
  token: string,
  repoId: number,
): Promise<Omit<CodeupRepo, "id" | "name" | "pathWithNamespace"> | null> {
  try {
    const res = await call(
      "GET",
      `/oapi/v1/codeup/organizations/${orgId}/repositories/${repoId}`,
      token,
    );
    const o = res as Record<string, unknown> | null;
    if (!o) return null;
    return {
      description: String(o.description ?? ""),
      creatorUid: o.creatorUid != null ? String(o.creatorUid) : "",
      lastActivityAt: String(o.lastActivityAt ?? o.updatedAt ?? ""),
      repositorySize:
        o.repositorySize != null ? Number(o.repositorySize) : null,
    };
  } catch {
    return null;
  }
}

/**
 * 组织成员 id/userId → 名字 的映射表(一次拉 200 个)。
 * 需要令牌带"组织信息"读权限,权限不够会抛错 —— 调用方接住给用户提示,
 * 不要在这里悄悄吞掉,不然创建人一直显示不出来都不知道为啥。
 */
export async function listMemberNames(
  orgId: string,
  token: string,
): Promise<Record<string, string>> {
  const res = await call(
    "POST",
    `/oapi/v1/platform/organizations/${orgId}/members:search`,
    token,
    { page: 1, perPage: 200, statuses: ["ENABLED"] },
  );
  const arr = Array.isArray(res)
    ? res
    : ((res as { result?: unknown[] } | null)?.result ?? []);
  const map: Record<string, string> = {};
  for (const m of arr as Record<string, unknown>[]) {
    const name = String(m.name ?? "");
    if (!name) continue;
    if (m.id != null) map[String(m.id)] = name;
    if (m.userId != null) map[String(m.userId)] = name;
  }
  return map;
}

/** 按关键字搜代码组(ListNamespaces + search,取前 100 条)。 */
export async function searchNamespaces(
  orgId: string,
  token: string,
  search: string,
): Promise<CodeupNamespace[]> {
  const q = encodeURIComponent(search.trim());
  const res = await call(
    "GET",
    `/oapi/v1/codeup/organizations/${orgId}/namespaces?search=${q}&page=1&perPage=100`,
    token,
  );
  const arr = Array.isArray(res)
    ? res
    : ((res as { result?: unknown[] } | null)?.result ?? []);
  const out: CodeupNamespace[] = [];
  for (const o of arr as Record<string, unknown>[]) {
    if (o.id == null) continue;
    out.push({
      id: Number(o.id),
      name: String(o.name ?? ""),
      pathWithNamespace: String(
        o.pathWithNamespace ?? o.fullPath ?? o.path ?? "",
      ),
      description: String(o.description ?? ""),
    });
  }
  return out;
}

/** 列某个代码组的直接子组(ListNamespaces + parentId,一层一层读)。 */
export async function listChildNamespaces(
  orgId: string,
  token: string,
  parentId: number,
): Promise<CodeupNamespace[]> {
  const out: CodeupNamespace[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await call(
      "GET",
      `/oapi/v1/codeup/organizations/${orgId}/namespaces?parentId=${parentId}&page=${page}&perPage=100&orderBy=created_at&sort=asc`,
      token,
    );
    const arr = Array.isArray(res)
      ? res
      : ((res as { result?: unknown[] } | null)?.result ?? []);
    if ((arr as unknown[]).length === 0) break;
    for (const o of arr as Record<string, unknown>[]) {
      if (o.id == null) continue;
      out.push({
        id: Number(o.id),
        name: String(o.name ?? ""),
        pathWithNamespace: String(
          o.pathWithNamespace ?? o.fullPath ?? o.path ?? "",
        ),
        description: String(o.description ?? ""),
      });
    }
    if ((arr as unknown[]).length < 100) break;
  }
  return out;
}

export type YunxiaoProject = {
  id: string;
  name: string;
  description: string;
  statusName: string;
};

/**
 * 拉取云效项目管理(Projex)的项目列表。一次拉 200 条按名称排序,
 * 搜索在前端本地过滤 —— 免得跟 conditions 那套 json 串格式较劲。
 */
export async function listProjects(
  orgId: string,
  token: string,
): Promise<YunxiaoProject[]> {
  const res = await call(
    "POST",
    `/oapi/v1/projex/organizations/${orgId}/projects:search`,
    token,
    { page: 1, perPage: 200, orderBy: "name", sort: "asc" },
  );
  const arr = Array.isArray(res)
    ? res
    : ((res as { result?: unknown[] } | null)?.result ?? []);
  return (arr as Record<string, unknown>[])
    .filter((r) => typeof r.name === "string" && String(r.name).trim() !== "")
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name),
      description: String(r.description ?? ""),
      statusName: String(
        (r.status as Record<string, unknown> | null)?.name ?? "",
      ),
    }));
}

/** 云效项目在网页端的地址。 */
export function projexUrl(orgId: string, projectId: string): string {
  return `https://devops.aliyun.com/projex/project/${projectId}?orgId=${orgId}`;
}

/**
 * 由组织 ID + 库路径拼 ssh 克隆地址。接口返回的 pathWithNamespace
 * 可能本身就带组织前缀,带了就不再重复拼。
 */
export function sshUrlFor(orgId: string, pathWithNamespace: string): string {
  const full = pathWithNamespace.startsWith(`${orgId}/`)
    ? pathWithNamespace
    : `${orgId}/${pathWithNamespace}`;
  return `git@codeup.aliyun.com:${full}.git`;
}
