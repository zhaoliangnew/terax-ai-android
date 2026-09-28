import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ChatItem } from "../lib/chatItems";
import { SdkChatModel, type SdkMessage } from "../lib/sdkChat";
import { type ClaudeUsage, claudeUsage, type UsageInfo } from "../lib/usage";

export type PermissionAsk = {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  blockedPath: string | null;
  canAlways: boolean;
};

export type ModelOption = {
  value: string;
  displayName: string;
  description: string;
  /** Codex:这个模型支持的推理强度(low…),从低到高。 */
  efforts?: string[];
  defaultEffort?: string;
  /** Codex:快速档(Fast)这类服务档位。 */
  tiers?: { id: string; name: string; description: string }[];
  /** Codex 推荐的默认模型。 */
  isDefault?: boolean;
};

export type ChatSession = {
  chatId: number | null;
  status: "starting" | "ready" | "closed" | "error";
  error: string | null;
  items: ChatItem[];
  working: boolean;
  model: string | null;
  permissionMode: string | null;
  sessionId: string | null;
  permissions: PermissionAsk[];
  models: ModelOption[];
  /** Codex:推理强度、服务档位(快速);Claude 没有,留空。 */
  effort?: string | null;
  serviceTier?: string | null;
  /** 套餐用量;还没查过是 undefined,查不到是 null。 */
  usage?: UsageInfo | null;
};

type Store = { sessions: Record<number, ChatSession> };

/**
 * 每个终端窗格各自的聊天会话(Claude Agent SDK,经 Rust 起的 Node 桥接进程)。
 * 放在模块级 store 里而不是组件里:切回终端视图时聊天组件会卸载,会话
 * 不能跟着断。
 */
export const useClaudeChatStore = create<Store>(() => ({ sessions: {} }));

const models = new Map<number, SdkChatModel>();
/** 每个窗格的聊天在哪个目录:记"上次的会话"按目录记。 */
const leafCwd = new Map<number, string>();

const lastSessionKey = (cwd: string) => `terax.chat.lastSession:${cwd}`;

/** 这个目录上次聊天用的会话 id,下次打开接着聊。 */
function lastSession(cwd: string): string | null {
  try {
    return localStorage.getItem(lastSessionKey(cwd));
  } catch {
    return null;
  }
}

function rememberSession(cwd: string, sessionId: string | null) {
  try {
    if (sessionId) localStorage.setItem(lastSessionKey(cwd), sessionId);
    else localStorage.removeItem(lastSessionKey(cwd));
  } catch {}
}

/** 会话还在启动(还没拿到 chatId)时发出的指令,拿到后按顺序补发。 */
const queued = new Map<number, Record<string, unknown>[]>();

function patch(leafId: number, next: Partial<ChatSession>) {
  useClaudeChatStore.setState((s) => {
    const cur = s.sessions[leafId];
    if (!cur) return s;
    return { sessions: { ...s.sessions, [leafId]: { ...cur, ...next } } };
  });
}

function snapshot(leafId: number) {
  const m = models.get(leafId);
  if (!m) return;
  patch(leafId, {
    items: [...m.items],
    working: m.working,
    model: m.model,
    permissionMode: m.permissionMode,
    sessionId: m.sessionId,
  });
}

/**
 * 流式输出一秒几十个小片段,每片都整个刷一次界面就会闪;这些合并到下一帧
 * 一起刷。别的消息(工具、结束)照常立刻刷。
 */
const pendingFrame = new Map<number, number>();
function snapshotNextFrame(leafId: number) {
  if (pendingFrame.has(leafId)) return;
  pendingFrame.set(
    leafId,
    requestAnimationFrame(() => {
      pendingFrame.delete(leafId);
      snapshot(leafId);
    }),
  );
}

function handleLine(leafId: number, owner: SdkChatModel, line: string) {
  // 换过会话之后,旧桥接进程晚到的消息(尤其是 closed)不能落到新会话上
  if (models.get(leafId) !== owner) return;
  let evt: {
    type?: string;
    msg?: SdkMessage;
    messages?: SdkMessage[];
    message?: string;
    models?: ModelOption[];
    usage?: ClaudeUsage;
  } & Partial<PermissionAsk>;
  try {
    evt = JSON.parse(line);
  } catch {
    return;
  }
  const m = models.get(leafId);
  if (!m) return;
  switch (evt.type) {
    case "sdk":
      if (evt.msg && m.apply(evt.msg)) {
        if (evt.msg.type === "stream_event") snapshotNextFrame(leafId);
        else snapshot(leafId);
      }
      if (evt.msg?.type === "system") {
        patch(leafId, { status: "ready" });
        const cwd = leafCwd.get(leafId);
        if (cwd && m.sessionId) rememberSession(cwd, m.sessionId);
      }
      return;
    case "history":
      // 旧对话铺在最前面;这时候新消息多半还没开始,顺序不会乱
      if (evt.messages?.length) {
        const live = m.items;
        m.items = [];
        m.loadHistory(evt.messages);
        m.items.push(...live);
        snapshot(leafId);
      }
      return;
    case "permission_request": {
      const cur = useClaudeChatStore.getState().sessions[leafId];
      if (!cur || !evt.id) return;
      patch(leafId, {
        permissions: [
          ...cur.permissions,
          {
            id: evt.id,
            toolName: evt.toolName ?? "",
            input: evt.input ?? {},
            blockedPath: evt.blockedPath ?? null,
            canAlways: evt.canAlways === true,
          },
        ],
      });
      return;
    }
    case "models":
      patch(leafId, { models: evt.models ?? [] });
      return;
    case "usage":
      patch(leafId, { usage: evt.usage ? claudeUsage(evt.usage) : null });
      return;
    case "error":
      m.addNote(`出错了:${evt.message ?? "未知错误"}`);
      m.working = false;
      snapshot(leafId);
      return;
    case "closed":
      m.working = false;
      snapshot(leafId);
      patch(leafId, { status: "closed", permissions: [] });
      return;
  }
}

function send(leafId: number, op: Record<string, unknown>) {
  const cur = useClaudeChatStore.getState().sessions[leafId];
  if (!cur) return;
  const chatId = cur.chatId;
  if (chatId == null) {
    if (cur.status === "starting") {
      queued.set(leafId, [...(queued.get(leafId) ?? []), op]);
    }
    return;
  }
  void invoke("claude_chat_send", {
    id: chatId,
    line: JSON.stringify(op),
  }).catch((e) => {
    const m = models.get(leafId);
    m?.addNote(`发送失败:${String(e)}`);
    snapshot(leafId);
  });
}

const MODE_KEY = "terax.chat.permissionMode";
const MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];

/**
 * 新会话用的权限模式:上次在聊天里选的;从没选过就是"完全访问"
 * (平时在终端里也是这么跑的)。
 */
function startPermissionMode(): string {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v && MODES.includes(v)) return v;
  } catch {}
  return "bypassPermissions";
}

/**
 * 这个窗格还没有聊天会话(或上一个已经结束)就起一个。默认接着这个目录
 * 上次的会话聊(历史消息会读出来铺上);`fresh` 开一个全新的。
 */
export function ensureChat(leafId: number, cwd: string, fresh = false) {
  const cur = useClaudeChatStore.getState().sessions[leafId];
  if (cur && cur.status !== "closed" && cur.status !== "error") return;
  const model = new SdkChatModel();
  const permissionMode = startPermissionMode();
  // 会话要等第一条消息才上报当前模式;在那之前先把要用的模式显示出来,
  // 不然左下角一直是空的"权限模式"
  model.permissionMode = permissionMode;
  models.set(leafId, model);
  leafCwd.set(leafId, cwd);
  const resume = fresh ? null : lastSession(cwd);
  useClaudeChatStore.setState((s) => ({
    sessions: {
      ...s.sessions,
      [leafId]: {
        chatId: null,
        status: "starting",
        error: null,
        items: [],
        working: false,
        model: null,
        permissionMode,
        sessionId: null,
        permissions: [],
        models: [],
      },
    },
  }));
  const channel = new Channel<string>();
  channel.onmessage = (line) => handleLine(leafId, model, line);
  invoke<number>("claude_chat_start", {
    cwd,
    resume,
    permissionMode,
    onEvent: channel,
  })
    .then((chatId) => {
      if (models.get(leafId) !== model) {
        // 启动途中又换了会话:这个进程没人要了
        void invoke("claude_chat_stop", { id: chatId });
        return;
      }
      patch(leafId, { chatId });
      const ops = queued.get(leafId) ?? [];
      queued.delete(leafId);
      for (const op of ops) send(leafId, op);
    })
    .catch((e) => patch(leafId, { status: "error", error: String(e) }));
}

export function sendChat(
  leafId: number,
  text: string,
  attachments: string[] = [],
) {
  const m = models.get(leafId);
  if (!m) return;
  m.addUser(text, attachments);
  snapshot(leafId);
  send(leafId, { op: "send", text, attachments });
}

export function respondPermission(
  leafId: number,
  id: string,
  allow: boolean,
  always = false,
) {
  const cur = useClaudeChatStore.getState().sessions[leafId];
  if (!cur) return;
  patch(leafId, { permissions: cur.permissions.filter((p) => p.id !== id) });
  send(leafId, { op: "permission", id, allow, always });
}

export function interruptChat(leafId: number) {
  send(leafId, { op: "interrupt" });
}

export function setChatModel(leafId: number, model: string) {
  const m = models.get(leafId);
  if (m) {
    m.model = model;
    snapshot(leafId);
  }
  send(leafId, { op: "set_model", model });
}

export function setChatMode(leafId: number, mode: string) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
  const m = models.get(leafId);
  if (m) {
    m.permissionMode = mode;
    snapshot(leafId);
  }
  send(leafId, { op: "set_mode", mode });
}

export function requestModels(leafId: number) {
  send(leafId, { op: "models" });
}

/** 查套餐用量(/usage 的数据),结果落在 session.usage。 */
export function requestUsage(leafId: number) {
  send(leafId, { op: "usage" });
}

/** 结束当前会话,换一个新的(相当于终端里的 /clear)。 */
export function restartChat(leafId: number, cwd: string) {
  const chatId = useClaudeChatStore.getState().sessions[leafId]?.chatId;
  if (chatId != null) void invoke("claude_chat_stop", { id: chatId });
  useClaudeChatStore.setState((s) => {
    const { [leafId]: _, ...rest } = s.sessions;
    return { sessions: rest };
  });
  models.delete(leafId);
  queued.delete(leafId);
  rememberSession(cwd, null);
  ensureChat(leafId, cwd, true);
}
