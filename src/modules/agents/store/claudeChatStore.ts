import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { ChatItem } from "../lib/chatItems";
import {
  type ContextUsage,
  SdkChatModel,
  type SdkMessage,
} from "../lib/sdkChat";
import type { SlashCommandOption } from "../lib/slashCommands";
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
  /** 当前上下文大小和占比;还没对话过是 null/undefined。 */
  context?: ContextUsage | null;
  /** 输入 / 能选的技能和命令(Codex 是 $ 选技能);undefined = 还没拿到。 */
  commands?: SlashCommandOption[];
  /** 正在压缩上下文:界面把"正在思考"换成"正在压缩上下文"。 */
  compacting?: boolean;
};

type Store = { sessions: Record<number, ChatSession> };

/** 一种"Claude 协议"聊天后端在 Rust 那边的命令名,和它在本地存东西用的前缀。 */
type SdkChatCommands = {
  start: string;
  send: string;
  stop: string;
  keyPrefix: string;
};

/**
 * 说 Claude Code 协议(stream-json + 控制请求)的聊天:Claude(经 Agent SDK
 * 桥接进程)和 Qoder(命令行直接就是这套协议)各一份,界面和消息解析共用。
 *
 * 每个终端窗格各自一个会话,放在模块级 store 里而不是组件里:切回终端视图时
 * 聊天组件会卸载,会话不能跟着断。
 */
function createSdkChat(cmds: SdkChatCommands) {
  const store = create<Store>(() => ({ sessions: {} }));

  const models = new Map<number, SdkChatModel>();
  /** 每个窗格的聊天在哪个目录:记"上次的会话"按目录记。 */
  const leafCwd = new Map<number, string>();

  const lastSessionKey = (cwd: string) =>
    `${cmds.keyPrefix}.lastSession:${cwd}`;

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

  /** 这些窗格的会话是因为"接不上上次的会话"退出的,关掉后自动开新的。 */
  const resumeFailed = new Set<number>();
  /** 会话还没起来(没收到 system 消息)时发出去的指令:会话没起来就挂了的话,
   * 换新会话时补发,用户刚发的那句不会丢。 */
  const unconfirmed = new Map<number, Record<string, unknown>[]>();

  /** 会话还在启动(还没拿到 chatId)时发出的指令,拿到后按顺序补发。 */
  const queued = new Map<number, Record<string, unknown>[]>();

  function patch(leafId: number, next: Partial<ChatSession>) {
    store.setState((s) => {
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
      context: m.context,
      commands: m.commands ?? undefined,
      compacting: m.compacting,
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
      commands?: unknown[];
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
          unconfirmed.delete(leafId);
        }
        // 一轮对话真正结束才记下会话:刚启动、还没说过话的会话不会存盘,
        // 记下来下次接不上(Qoder 会直接报会话 id 无效退出)
        if (evt.msg?.type === "result") {
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
        const cur = store.getState().sessions[leafId];
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
      case "commands":
        m.setCommands(evt.commands);
        snapshot(leafId);
        return;
      case "usage":
        patch(leafId, { usage: evt.usage ? claudeUsage(evt.usage) : null });
        return;
      case "error":
        // 接上次的会话失败(会话被删了、没存盘):别报错,关掉后换个新会话
        if (/resuming session|No conversation found/i.test(evt.message ?? "")) {
          resumeFailed.add(leafId);
          return;
        }
        m.addNote(`出错了:${evt.message ?? "未知错误"}`);
        m.working = false;
        snapshot(leafId);
        return;
      case "closed": {
        m.working = false;
        snapshot(leafId);
        patch(leafId, { status: "closed", permissions: [] });
        const cwd = leafCwd.get(leafId);
        if (resumeFailed.delete(leafId) && cwd) {
          const retry = unconfirmed.get(leafId) ?? [];
          unconfirmed.delete(leafId);
          rememberSession(cwd, null);
          ensureChat(leafId, cwd, true);
          if (retry.length) queued.set(leafId, retry);
        }
        return;
      }
    }
  }

  function send(leafId: number, op: Record<string, unknown>) {
    const cur = store.getState().sessions[leafId];
    if (!cur) return;
    if (cur.status === "starting" && op.op === "send") {
      unconfirmed.set(leafId, [...(unconfirmed.get(leafId) ?? []), op]);
    }
    const chatId = cur.chatId;
    if (chatId == null) {
      if (cur.status === "starting") {
        queued.set(leafId, [...(queued.get(leafId) ?? []), op]);
      }
      return;
    }
    void invoke(cmds.send, {
      id: chatId,
      line: JSON.stringify(op),
    }).catch((e) => {
      const m = models.get(leafId);
      m?.addNote(`发送失败:${String(e)}`);
      snapshot(leafId);
    });
  }

  const MODE_KEY = `${cmds.keyPrefix}.permissionMode`;
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
  function ensureChat(leafId: number, cwd: string, fresh = false) {
    const cur = store.getState().sessions[leafId];
    if (cur && cur.status !== "closed" && cur.status !== "error") return;
    const model = new SdkChatModel();
    const permissionMode = startPermissionMode();
    // 会话要等第一条消息才上报当前模式;在那之前先把要用的模式显示出来,
    // 不然左下角一直是空的"权限模式"
    model.permissionMode = permissionMode;
    models.set(leafId, model);
    leafCwd.set(leafId, cwd);
    const resume = fresh ? null : lastSession(cwd);
    store.setState((s) => ({
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
    invoke<number>(cmds.start, {
      cwd,
      resume,
      permissionMode,
      onEvent: channel,
    })
      .then((chatId) => {
        if (models.get(leafId) !== model) {
          // 启动途中又换了会话:这个进程没人要了
          void invoke(cmds.stop, { id: chatId });
          return;
        }
        patch(leafId, { chatId });
        const ops = queued.get(leafId) ?? [];
        queued.delete(leafId);
        for (const op of ops) send(leafId, op);
      })
      .catch((e) => patch(leafId, { status: "error", error: String(e) }));
  }

  function sendChat(leafId: number, text: string, attachments: string[] = []) {
    const m = models.get(leafId);
    if (!m) return;
    m.addUser(text, attachments);
    snapshot(leafId);
    send(leafId, { op: "send", text, attachments });
  }

  function respondPermission(
    leafId: number,
    id: string,
    allow: boolean,
    always = false,
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) {
    const cur = store.getState().sessions[leafId];
    if (!cur) return;
    patch(leafId, { permissions: cur.permissions.filter((p) => p.id !== id) });
    send(leafId, {
      op: "permission",
      id,
      allow,
      always,
      updatedInput,
      message,
    });
  }

  function interruptChat(leafId: number) {
    send(leafId, { op: "interrupt" });
  }

  function setChatModel(leafId: number, model: string) {
    const m = models.get(leafId);
    if (m) {
      m.model = model;
      snapshot(leafId);
    }
    send(leafId, { op: "set_model", model });
  }

  function setChatMode(leafId: number, mode: string) {
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

  function requestModels(leafId: number) {
    send(leafId, { op: "models" });
  }

  /** 带说明的技能/命令列表,结果落在 session.commands。 */
  function requestCommands(leafId: number) {
    send(leafId, { op: "commands" });
  }

  /** 查套餐用量(/usage 的数据),结果落在 session.usage。 */
  function requestUsage(leafId: number) {
    send(leafId, { op: "usage" });
  }

  /**
   * 把会话交给命令行:停掉这边的进程,会话记录留在磁盘上;切回聊天时
   * ensureChat 按"这个目录上次的会话"读回来,命令行里聊的也在。
   */
  function suspendChat(leafId: number) {
    const cur = store.getState().sessions[leafId];
    const cwd = leafCwd.get(leafId);
    if (cwd && cur?.sessionId) rememberSession(cwd, cur.sessionId);
    if (cur?.chatId != null) void invoke(cmds.stop, { id: cur.chatId });
    store.setState((s) => {
      const { [leafId]: _, ...rest } = s.sessions;
      return { sessions: rest };
    });
    models.delete(leafId);
    queued.delete(leafId);
    unconfirmed.delete(leafId);
  }

  /** 结束当前会话,换一个新的(相当于终端里的 /clear)。 */
  function restartChat(leafId: number, cwd: string) {
    const chatId = store.getState().sessions[leafId]?.chatId;
    if (chatId != null) void invoke(cmds.stop, { id: chatId });
    store.setState((s) => {
      const { [leafId]: _, ...rest } = s.sessions;
      return { sessions: rest };
    });
    models.delete(leafId);
    queued.delete(leafId);
    rememberSession(cwd, null);
    ensureChat(leafId, cwd, true);
  }

  return {
    store,
    ensureChat,
    sendChat,
    respondPermission,
    interruptChat,
    setChatModel,
    setChatMode,
    requestModels,
    requestUsage,
    requestCommands,
    restartChat,
    suspendChat,
  };
}

const claude = createSdkChat({
  start: "claude_chat_start",
  send: "claude_chat_send",
  stop: "claude_chat_stop",
  keyPrefix: "terax.chat",
});

export const useClaudeChatStore = claude.store;
export const {
  ensureChat,
  sendChat,
  respondPermission,
  interruptChat,
  setChatModel,
  setChatMode,
  requestModels,
  requestUsage,
  requestCommands,
  restartChat,
  suspendChat,
} = claude;

/** Qoder 聊天:Rust 直接起 qoderclicn,协议和 Claude 一样。 */
export const qoderChat = createSdkChat({
  start: "qoder_chat_start",
  send: "qoder_chat_send",
  stop: "qoder_chat_stop",
  keyPrefix: "terax.qoderChat",
});

/** 名字得是 use 开头:React Compiler 只把 use* 当 hook,别的调用可能被它缓存跳过。 */
export const useQoderChatStore = qoderChat.store;
