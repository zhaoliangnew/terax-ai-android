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

/**
 * curl 调用的底层实现,顺带能要回 x-total 这个分页总数响应头
 * (需求/任务列表的数量角标要用)。大多数调用方不关心总数,
 * 用下面的 call() 薄封装就够了。
 */
async function curlCall(
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string,
  body?: unknown,
): Promise<{ data: unknown; total: number | null }> {
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
    "\n__HTTP_%{http_code}__\n__TOTAL_%header{x-total}__",
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
  const totalMatch = /\n__TOTAL_(\d*)__\s*$/.exec(out.stdout);
  const total = totalMatch?.[1] ? Number(totalMatch[1]) : null;
  const withoutTotal = totalMatch
    ? out.stdout.slice(0, totalMatch.index)
    : out.stdout;
  const m = /\n__HTTP_(\d+)__\s*$/.exec(withoutTotal);
  const status = m ? Number(m[1]) : 0;
  const raw = m ? withoutTotal.slice(0, m.index) : withoutTotal;
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
  return { data: parsed, total };
}

async function call(
  method: "GET" | "POST" | "PUT",
  path: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  return (await curlCall(method, path, token, body)).data;
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

/** 组织成员。userId 才是工作项 assignedTo.id / creator.id 里用的那个值。 */
export type YunxiaoMember = { userId: string; name: string };

async function fetchMembers(
  orgId: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  const res = await call(
    "POST",
    `/oapi/v1/platform/organizations/${orgId}/members:search`,
    token,
    { page: 1, perPage: 200, statuses: ["ENABLED"] },
  );
  const arr = Array.isArray(res)
    ? res
    : ((res as { result?: unknown[] } | null)?.result ?? []);
  return arr as Record<string, unknown>[];
}

/**
 * 组织成员 id/userId → 名字 的映射表(一次拉 200 个),只用来"按 ID 查名字"。
 * 两种 ID 都塞进去是因为不同接口给的 ID 不一样(代码库给 creatorUid,
 * 对应 userId)。要拿来做下拉选项请用 listMembers,不然会一人出现两次。
 * 需要令牌带"组织信息"读权限,权限不够会抛错 —— 调用方接住给用户提示,
 * 不要在这里悄悄吞掉,不然创建人一直显示不出来都不知道为啥。
 */
export async function listMemberNames(
  orgId: string,
  token: string,
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const m of await fetchMembers(orgId, token)) {
    const name = String(m.name ?? "");
    if (!name) continue;
    if (m.id != null) map[String(m.id)] = name;
    if (m.userId != null) map[String(m.userId)] = name;
  }
  return map;
}

/** 成员列表(每人一条,按名字排序),给"改负责人"的选择器用。 */
export async function listMembers(
  orgId: string,
  token: string,
): Promise<YunxiaoMember[]> {
  const seen = new Set<string>();
  const out: YunxiaoMember[] = [];
  for (const m of await fetchMembers(orgId, token)) {
    const name = String(m.name ?? "");
    const userId = m.userId != null ? String(m.userId) : "";
    if (!name || !userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
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
 * 拉取云效项目管理(Projex)的项目列表,按名称排序。
 *
 * 组织里项目有好几百个,不做全量拉取(翻页翻到底又慢又没意义):
 * 不带关键字时只取前 perPage 条当默认列表,带关键字时交给服务端做
 * 模糊匹配。关键字过滤要用 extraConditions 那套 JSON 串,顶层的
 * name/search/keyword 参数服务端根本不认(实测会被忽略,返回全量)。
 */
export async function listProjects(
  orgId: string,
  token: string,
  search = "",
  perPage = 30,
): Promise<YunxiaoProject[]> {
  const q = search.trim();
  const body: Record<string, unknown> = {
    page: 1,
    perPage,
    orderBy: "name",
    sort: "asc",
  };
  if (q) {
    body.extraConditions = JSON.stringify({
      conditionGroups: [
        [
          {
            className: "string",
            fieldIdentifier: "name",
            format: "input",
            operator: "CONTAINS",
            value: [q],
          },
        ],
      ],
    });
  }
  const res = await call(
    "POST",
    `/oapi/v1/projex/organizations/${orgId}/projects:search`,
    token,
    body,
  );
  const arr = (
    Array.isArray(res)
      ? res
      : ((res as { result?: unknown[] } | null)?.result ?? [])
  ) as Record<string, unknown>[];
  return arr
    .filter((r) => typeof r.name === "string" && r.name.trim() !== "")
    .map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name),
      description: String(r.description ?? ""),
      statusName: String(
        (r.status as Record<string, unknown> | null)?.name ?? "",
      ),
    }));
}

/** 工作项类别:需求/任务,云效那边叫 categoryId。 */
export type WorkitemCategory = "Req" | "Task";

export type Workitem = {
  id: string;
  /** 显示的标题字段叫 subject,不是 name。 */
  subject: string;
  /** 需求 xxx、任务 xxx 那个编号。 */
  serialNumber: string;
  statusName: string;
  /** 改状态时 UpdateWorkitem 要传这个 id,不是显示名。 */
  statusId: string;
  assignedTo: string;
  assignedToId: string;
  creator: string;
  creatorId: string;
  gmtCreate: string;
  /** 下面四个是自定义字段(customFieldValues),按 fieldName 匹配取的:
   * "计划开始时间"/"计划完成时间"/"预计工时"/"实际工时"。项目模板不统一,
   * 没配这几个字段的项目就是空字符串,对应的 xxxFieldId 也是空。
   * fieldId 是每个项目自己的编号(不是固定值),回写要用它当 key。 */
  startDate: string;
  startDateFieldId: string;
  dueDate: string;
  dueDateFieldId: string;
  estimatedHours: string;
  estimatedHoursFieldId: string;
  actualHours: string;
  actualHoursFieldId: string;
};

function parseWorkitemUserName(u: unknown): string {
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
  }
  return "";
}

function parseWorkitemUserId(u: unknown): string {
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    if (o.id != null) return String(o.id);
  }
  return "";
}

/** 自定义字段按中文字段名找,取第一个值的 displayValue + 这个字段的 fieldId。 */
function customField(
  customFieldValues: unknown,
  fieldName: string,
): { display: string; fieldId: string } {
  if (!Array.isArray(customFieldValues)) return { display: "", fieldId: "" };
  for (const f of customFieldValues as Record<string, unknown>[]) {
    if (f.fieldName !== fieldName) continue;
    const values = f.values;
    const display =
      Array.isArray(values) && values[0]
        ? String(
            (values[0] as Record<string, unknown>).displayValue ??
              (values[0] as Record<string, unknown>).identifier ??
              "",
          )
        : "";
    return { display, fieldId: String(f.fieldId ?? "") };
  }
  return { display: "", fieldId: "" };
}

function parseWorkitem(r: Record<string, unknown>): Workitem | null {
  if (r.id == null) return null;
  const status = r.status as Record<string, unknown> | null;
  const cfv = r.customFieldValues;
  const start = customField(cfv, "计划开始时间");
  const due = customField(cfv, "计划完成时间");
  // 任务有可直接填的"预计工时/实际工时";需求没有,只有子项累加出来的
  // "…汇总"(fieldFormat=auto)。汇总只读,所以取汇总时不带 fieldId,
  // 上层就自动不给编辑了。
  const est = customField(cfv, "预计工时");
  const estSum = est.display ? est : customField(cfv, "预计工时汇总");
  const act = customField(cfv, "实际工时");
  const actSum = act.display ? act : customField(cfv, "实际工时汇总");
  return {
    id: String(r.id),
    subject: String(r.subject ?? ""),
    serialNumber: String(r.serialNumber ?? ""),
    statusName: String(status?.displayName ?? status?.name ?? ""),
    statusId: status?.id != null ? String(status.id) : "",
    assignedTo: parseWorkitemUserName(r.assignedTo),
    assignedToId: parseWorkitemUserId(r.assignedTo),
    creator: parseWorkitemUserName(r.creator),
    creatorId: parseWorkitemUserId(r.creator),
    gmtCreate: String(r.gmtCreate ?? ""),
    startDate: start.display,
    startDateFieldId: start.fieldId,
    dueDate: due.display,
    dueDateFieldId: due.fieldId,
    estimatedHours: estSum.display,
    estimatedHoursFieldId: est.fieldId,
    actualHours: actSum.display,
    actualHoursFieldId: act.fieldId,
  };
}

/**
 * 查某个 Projex 项目下的需求/任务列表(SearchWorkitems)。
 * total 来自响应头 x-total,用来显示 tab 上的数量角标。
 */
export async function searchWorkitems(
  orgId: string,
  token: string,
  spaceId: string,
  category: WorkitemCategory,
  page = 1,
  perPage = 100,
  /** 只看这个人负责的(传云效用户 ID,也就是 assignedTo.id)。 */
  assignedToUserId?: string,
): Promise<{ items: Workitem[]; total: number }> {
  const body: Record<string, unknown> = {
    spaceId,
    category,
    page,
    perPage,
    orderBy: "gmtCreate",
    sort: "desc",
  };
  if (assignedToUserId) {
    body.conditions = JSON.stringify({
      conditionGroups: [
        [
          {
            className: "user",
            fieldIdentifier: "assignedTo",
            format: "list",
            operator: "CONTAINS",
            value: [assignedToUserId],
          },
        ],
      ],
    });
  }
  const { data, total } = await curlCall(
    "POST",
    `/oapi/v1/projex/organizations/${orgId}/workitems:search`,
    token,
    body,
  );
  const arr = Array.isArray(data)
    ? data
    : ((data as { result?: unknown[] } | null)?.result ?? []);
  const items = (arr as Record<string, unknown>[])
    .map(parseWorkitem)
    .filter((w): w is Workitem => w !== null);
  return { items, total: total ?? items.length };
}

/**
 * 改工作项字段。请求体是**平铺**的 `{字段: 值}`,自定义字段直接用它的
 * fieldId 当 key 放在顶层 —— 不要套 customFieldValues,那个容器只在
 * 返回里有,请求里套一层是不认的。内置字段的 key 就是 status /
 * assignedTo / subject / priority 这些。
 *
 * 需要令牌带「项目协作 → 工作项 = 读写」权限,只有只读会 403。
 */
export async function updateWorkitem(
  orgId: string,
  token: string,
  workitemId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await call(
    "PUT",
    `/oapi/v1/projex/organizations/${orgId}/workitems/${workitemId}`,
    token,
    patch,
  );
}

const VIEWS_KEY = "yunxiao.workitemViews";

/** 自己攒的云效"工作项视图"快捷入口:名字 + 网页地址。 */
export type WorkitemView = { name: string; url: string };

/**
 * 云效没有开放跨项目查工作项的接口(spaceId 必填,组织下 200+ 个项目
 * 逐个查不现实),所以这些视图只能跳网页,做不到在本地重建。
 * 视图名字和地址都由用户自己加,不写死。
 */
export function getWorkitemViews(): WorkitemView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (v): v is WorkitemView =>
          !!v && typeof v.name === "string" && typeof v.url === "string",
      )
      .map((v) => ({ name: v.name.trim(), url: v.url.trim() }))
      .filter((v) => v.name && v.url);
  } catch {
    return [];
  }
}

export function setWorkitemViews(views: WorkitemView[]): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
}

export type YunxiaoSelf = { id: string; name: string };

/**
 * 令牌属于谁。返回的 id 就是工作项里 assignedTo.id / creator.id 那个值,
 * 所以判断"这条是不是我的"直接比 id,不用比姓名(组织里有重名的人)。
 */
export async function getSelf(token: string): Promise<YunxiaoSelf | null> {
  try {
    const res = await call("GET", "/oapi/v1/platform/user", token);
    const o = res as Record<string, unknown> | null;
    if (!o?.id) return null;
    return { id: String(o.id), name: String(o.name ?? "") };
  } catch {
    return null;
  }
}

/**
 * 工作项在网页端的地址。实测抓的真实地址是
 * `.../project/{projectId}/task#openWorkitemIdentifier={id}`,
 * 不带 orgId 查询参数——之前猜的 `/workitem/{id}?orgId=` 路径是错的。
 */
export function workitemUrl(projectId: string, workitemId: string): string {
  return `https://devops.aliyun.com/projex/project/${projectId}/task#openWorkitemIdentifier=${workitemId}`;
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
