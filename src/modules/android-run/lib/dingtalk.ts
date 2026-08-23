import { native } from "@/modules/ai/lib/native";
import { toast } from "sonner";
import { DEFAULT_DING_ENTRIES } from "./dingDefaults";
import { shellQuote } from "./openExternally";

const GROUPS_KEY = "terax.dingtalk.groups";
const BINDINGS_KEY = "terax.dingtalk.groupBindings";

/**
 * 只存名字 —— 因为跳转做不到(见下面 revealConversation 的注释),
 * 我们能做的就是把名字塞进剪贴板,存 conversationId / userId 没有意义。
 */
export type DingEntry = {
  id: string;
  name: string;
  /** 群还是人,只影响图标。 */
  kind?: "group" | "person";
  /** 分组小标题,比如"嵌入式开发组"、"测试组"。 */
  team?: string;
};

function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const BUILTIN_IDS = new Set(DEFAULT_DING_ENTRIES.map((d) => d.id));
const BUILTIN_NAMES = new Set(DEFAULT_DING_ENTRIES.map((d) => d.name));

export function isBuiltinEntry(entry: DingEntry): boolean {
  return BUILTIN_IDS.has(entry.id);
}

/**
 * 内置那份永远从代码里来,localStorage 只存自定义的 —— 跟嵌入式组知识库同一套
 * 路子。这样改代码更新名单能立刻对所有人生效,不会被谁机器上的旧副本盖住。
 *
 * 顺手滤掉跟内置重名的自定义项:早期版本把默认清单写进过 localStorage,
 * 不滤的话那批会跟内置项并排显示两遍。
 */
export function loadCustomGroups(): DingEntry[] {
  const stored = read<DingEntry[]>(GROUPS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (g) =>
      g?.id && g?.name && !BUILTIN_IDS.has(g.id) && !BUILTIN_NAMES.has(g.name),
  );
}

/** 内置 + 自定义,界面按这个渲染。 */
export function loadGroups(): DingEntry[] {
  return [...DEFAULT_DING_ENTRIES, ...loadCustomGroups()];
}

function saveCustom(groups: DingEntry[]): DingEntry[] {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  return loadGroups();
}

export function newGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function upsertGroup(group: DingEntry): DingEntry[] {
  if (BUILTIN_IDS.has(group.id)) return loadGroups();
  const custom = loadCustomGroups();
  const i = custom.findIndex((g) => g.id === group.id);
  if (i >= 0) custom[i] = group;
  else custom.push(group);
  return saveCustom(custom);
}

export function removeGroup(id: string): DingEntry[] {
  if (BUILTIN_IDS.has(id)) return loadGroups();
  return saveCustom(loadCustomGroups().filter((g) => g.id !== id));
}

export function moveGroup(id: string, delta: number): DingEntry[] {
  if (BUILTIN_IDS.has(id)) return loadGroups();
  const custom = loadCustomGroups();
  const i = custom.findIndex((g) => g.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= custom.length) return loadGroups();
  [custom[i], custom[j]] = [custom[j], custom[i]];
  return saveCustom(custom);
}

/** 清空自定义条目,内置的不受影响。 */
export function clearCustomGroups(): DingEntry[] {
  return saveCustom([]);
}

/**
 * 直接跳进某个群:做不到。
 *
 * 试过四条路,全断:
 *  - `dingtalk://dingtalkclient/action/openConversation` 只有手机端认,
 *    桌面版弹"暂时无法打开该链接,请在手机上查看";
 *  - `dd.openChatByConversationId()` 是 JSAPI,只能在钉钉自己的 H5 容器里跑;
 *  - AppleScript 模拟按键要 Accessibility 授权,而且钉钉搜索框那套手动流程
 *    本身就进不去群;
 *  - `dws chat` 清一色是服务端 API,没有操作本机客户端的命令。
 *
 * 所以退一步:把群名塞进剪贴板,再把钉钉切到前台,剩下粘贴一下。省掉
 * "想群名"和"切窗口"两步,不假装能一键直达。
 */
export async function revealConversation(name: string): Promise<void> {
  await native.shellBgSpawn(
    `printf %s ${shellQuote(name)} | pbcopy; open -a DingTalk`,
    null,
  );
  toast.success("已复制群名", {
    description: `“${name}” —— 在钉钉搜索框粘贴即可`,
  });
}

// ---- 目录 → 群 的绑定 ----------------------------------------------------
// 跟云效项目一样,群对应的是产品线**目录**,底下每个工程继承同一个对接群。

function loadBindings(): Record<string, string> {
  return read<Record<string, string>>(BINDINGS_KEY, {});
}

export function setGroupBinding(dir: string, name: string | null): void {
  const all = loadBindings();
  const key = dir.replace(/\/+$/, "");
  if (name) all[key] = name;
  else delete all[key];
  localStorage.setItem(BINDINGS_KEY, JSON.stringify(all));
}

export type ResolvedGroup = { dir: string; name: string };

/** 从 `startDir` 逐级向上找最近一个绑过群的目录。 */
export function resolveGroupBinding(startDir: string): ResolvedGroup | null {
  const all = loadBindings();
  let dir = startDir.replace(/\/+$/, "");
  while (dir.length > 1) {
    const name = all[dir];
    if (name) return { dir, name };
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}
