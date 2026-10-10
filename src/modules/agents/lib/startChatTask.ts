import type { Tab } from "@/modules/tabs/lib/useTabs";
import { findLeafCwd, hasLeaf, leafIds } from "@/modules/terminal/lib/panes";
import { useAgentViewStore } from "../store/agentViewStore";
import {
  CHAT_APIS,
  type ChatAgent,
  chatSessionNow,
} from "../store/chatProviders";
import { saveAgent, saveView } from "./chatPrefs";

/*
 * 「在某个目录新开一个聊天 tab,把一段话发给 AI」:云效任务点"开始开发"
 * 走这里。发请求的一方(浮层)拿不到 tab 和窗格,所以派一个 window 事件,
 * 由 App 里的 useChatTaskLauncher 接住去开 tab。
 */

/** 请 App 开一个聊天 tab 开工。detail: StartChatTaskDetail */
export const START_CHAT_TASK = "terax:start-chat-task";

export type StartChatTaskDetail = {
  /** 任务的唯一标识(云效工作项 id):同一条任务的 tab 还开着就不再开。 */
  key: string;
  /** 在哪个目录开(worktree 或仓库本身)。 */
  dir: string;
  /** tab 标题。 */
  title: string;
  /** 第一条消息。 */
  prompt: string;
  /** 任务链接:记成这个目录的「当前云效需求」。 */
  url: string;
  agent: ChatAgent;
};

export function requestChatTask(d: StartChatTaskDetail): void {
  window.dispatchEvent(new CustomEvent(START_CHAT_TASK, { detail: d }));
}

/**
 * 从任务开的会话一律"改文件前先问":第一条消息里带着云效上的原文(外部
 * 输入),不能拿到就直接放开改。Codex 没有"先问"这一档,只读最接近。
 */
export const TASK_PERMISSION_MODE: Record<ChatAgent, string> = {
  claude: "default",
  codex: "readonly",
  qoder: "default",
};

/** 确认面板上怎么说这个权限,名字和聊天输入框左下角的一致。 */
export const TASK_PERMISSION_LABEL: Record<ChatAgent, string> = {
  claude: "默认权限:改文件、执行命令前都先问你",
  codex: "只读:要改文件或执行命令先问你",
  qoder: "默认权限:改文件、执行命令前都先问你",
};

/**
 * 在一个窗格里开新会话并发出第一条消息。必须和开 tab 在同一个 tick 里调:
 * 窗格挂上时 modes 里已经有它,LeafAgentChat 的恢复逻辑才不会抢先接上这个
 * 目录的旧会话(那样 ensure 就成了空操作,需求会发进旧对话里)。
 */
export function launchChatInLeaf(
  leafId: number,
  dir: string,
  agent: ChatAgent,
  prompt: string,
): void {
  const view = useAgentViewStore.getState();
  // 先记下用谁:输入框没选过时按 Claude 画
  view.setAgent(leafId, agent);
  saveAgent(dir, agent);
  // Claude/Qoder 拿到 chatId 前 send 会排队,Codex 会等会话建好,所以紧接着发是安全的
  CHAT_APIS[agent].ensure(leafId, dir, {
    fresh: true,
    permissionMode: TASK_PERMISSION_MODE[agent],
  });
  view.setMode(leafId, "chat");
  saveView(dir, "chat");
  CHAT_APIS[agent].send(leafId, prompt, []);
}

/**
 * 启动失败后重来一次。必须走 restart:ensure 不清 Claude/Qoder 排着队的
 * 旧消息,新会话起来会把它补发出去,再 send 就重复发了。
 */
export function retryChatTask(
  leafId: number,
  dir: string,
  agent: ChatAgent,
  prompt: string,
): void {
  const view = useAgentViewStore.getState();
  view.setAgent(leafId, agent);
  CHAT_APIS[agent].restart(leafId, dir, {
    permissionMode: TASK_PERMISSION_MODE[agent],
  });
  view.setMode(leafId, "chat");
  CHAT_APIS[agent].send(leafId, prompt, []);
}

/* ---- 哪条任务开在哪个 tab ---- */

export type TaskTab = {
  tabId: number;
  leafId: number;
  dir: string;
  title: string;
  /** 开 tab 的时刻:tab 列表要等下一次渲染提交后才看得到它。 */
  at: number;
  /** 在 tab 列表里见到过了。 */
  seen: boolean;
  /** 用的哪个 AI、第一条消息:启动失败后再点这条任务时拿来重来。 */
  agent?: ChatAgent;
  prompt?: string;
};

/** 刚开的 tab 在这段时间里还没进 tab 列表,不能当成已经关了。 */
const PENDING_MS = 3000;

/**
 * 这条任务的 tab 现在怎样:开着、刚开还没进列表、已经关了(tab 或窗格没了)。
 * 会把 entry.seen 记上,见过一次之后再找不到就是真关了。
 */
export function taskTabState(
  entry: TaskTab,
  tabs: readonly Tab[],
  now: number,
): "open" | "pending" | "gone" {
  const tab = tabs.find((t) => t.id === entry.tabId);
  if (tab) {
    if (tab.kind !== "terminal" || !hasLeaf(tab.paneTree, entry.leafId)) {
      return "gone";
    }
    entry.seen = true;
    return "open";
  }
  return !entry.seen && now - entry.at < PENDING_MS ? "pending" : "gone";
}

/** App 那边提供的:当前的 tab 列表,和切到某个窗格。 */
export type ChatTaskHost = {
  tabs: () => readonly Tab[];
  focus: (tabId: number, leafId: number) => void;
  /** tab 恢复完了没有;没恢复完时 tab 列表是空的,不能据此把任务当成关了。 */
  ready?: () => boolean;
  /** 会话没启动起来:重来一次(restart + 重发第一条)。 */
  retry?: (key: string, entry: TaskTab) => void;
};

const taskTabs = new Map<string, TaskTab>();
let host: ChatTaskHost | null = null;

/*
 * 任务 → tab 的登记也写进 localStorage:tab 会跟着 space 存盘、重启后恢复,
 * 只记在内存里的话重启后点这条任务会再开一个 tab、再发一遍需求,两个会话
 * 改同一个 worktree。重启后 tab/窗格 id 会变,所以按标题 + 目录认回来。
 */
const SAVED_KEY = "terax.chat.taskTabs.v1";
const SAVED_MAX = 100;
export type SavedTask = { dir: string; title: string; agent?: ChatAgent };

function loadSaved(): Record<string, SavedTask> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, SavedTask> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const o = v as Partial<SavedTask> | null;
      if (k === "__proto__" || !o || typeof o !== "object") continue;
      if (typeof o.dir !== "string" || typeof o.title !== "string") continue;
      const agent =
        o.agent === "claude" || o.agent === "codex" || o.agent === "qoder"
          ? o.agent
          : undefined;
      out[k] = { dir: o.dir, title: o.title, agent };
    }
    return out;
  } catch {
    return {};
  }
}

function writeSaved(all: Record<string, SavedTask>): void {
  try {
    // 插入顺序就是登记顺序,太多了丢最早的
    const entries = Object.entries(all).slice(-SAVED_MAX);
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {}
}

function forgetSaved(key: string): void {
  const all = loadSaved();
  if (!(key in all)) return;
  delete all[key];
  writeSaved(all);
}

/** 恢复出来的 tab 里认回这条任务:标题一样、有个窗格就在任务目录上。 */
export function findRestoredTaskTab(
  saved: SavedTask,
  tabs: readonly Tab[],
): { tabId: number; leafId: number } | null {
  for (const t of tabs) {
    if (t.kind !== "terminal" || t.customTitle !== saved.title) continue;
    for (const id of leafIds(t.paneTree)) {
      if ((findLeafCwd(t.paneTree, id) ?? t.cwd) === saved.dir) {
        return { tabId: t.id, leafId: id };
      }
    }
  }
  return null;
}

/** 会话当初没启动起来(启动报错,或者还没起来就退出了)。 */
function startFailed(entry: TaskTab): boolean {
  if (!entry.agent) return false;
  const s = chatSessionNow(entry.agent, entry.leafId);
  return !!s && !s.sessionId && (s.status === "error" || s.status === "closed");
}

/** useChatTaskLauncher 挂上时登记;返回注销。 */
export function bindChatTaskHost(h: ChatTaskHost): () => void {
  host = h;
  return () => {
    if (host === h) host = null;
  };
}

export function rememberChatTask(key: string, entry: TaskTab): void {
  taskTabs.set(key, entry);
  const all = loadSaved();
  delete all[key];
  all[key] = { dir: entry.dir, title: entry.title, agent: entry.agent };
  writeSaved(all);
}

/** 这条任务开着的 tab(关了或没开过是 null)。 */
export function liveChatTask(key: string): TaskTab | null {
  if (!host) return null;
  const entry = taskTabs.get(key);
  if (!entry) {
    // tab 还没恢复完时什么也看不到,别把存着的登记当成关了删掉
    if (host.ready && !host.ready()) return null;
    const saved = loadSaved()[key];
    if (!saved) return null;
    const hit = findRestoredTaskTab(saved, host.tabs());
    if (!hit) {
      forgetSaved(key);
      return null;
    }
    const adopted: TaskTab = {
      ...hit,
      dir: saved.dir,
      title: saved.title,
      at: Date.now(),
      seen: true,
      agent: saved.agent,
    };
    taskTabs.set(key, adopted);
    return adopted;
  }
  if (taskTabState(entry, host.tabs(), Date.now()) === "gone") {
    taskTabs.delete(key);
    forgetSaved(key);
    return null;
  }
  return entry;
}

/** 这条任务开的聊天 tab 还在不在。 */
export function isChatTaskOpen(key: string): boolean {
  return liveChatTask(key) !== null;
}

/** 这条任务的 tab 还开着就切过去,返回 true;没开着返回 false。 */
export function focusChatTask(key: string): boolean {
  const entry = liveChatTask(key);
  if (!entry || !host) return false;
  host.focus(entry.tabId, entry.leafId);
  return true;
}

/**
 * 又点了这条任务:tab 开着就切过去;会话当初没启动起来就顺手重来一次
 * (重试 toast 早就消失了,只切过去的话用户只能对着死会话,在输入框里
 * 打字还会接上这个目录别的对话)。没开着返回 null。
 */
export function reopenChatTask(key: string): "focused" | "retried" | null {
  const entry = liveChatTask(key);
  if (!entry || !host) return null;
  host.focus(entry.tabId, entry.leafId);
  if (entry.prompt && host.retry && startFailed(entry)) {
    host.retry(key, entry);
    return "retried";
  }
  return "focused";
}

/** 同一个目录上还开着的别的任务(两个会话会改同一个工作区)。 */
export function otherTaskOnDir(dir: string, exceptKey: string): TaskTab | null {
  const keys = new Set([...taskTabs.keys(), ...Object.keys(loadSaved())]);
  for (const key of keys) {
    if (key === exceptKey) continue;
    const entry = liveChatTask(key);
    if (entry?.dir === dir) return entry;
  }
  return null;
}
