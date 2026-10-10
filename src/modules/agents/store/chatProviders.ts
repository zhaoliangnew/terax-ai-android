import {
  type ChatSession,
  ensureChat,
  interruptChat,
  qoderChat,
  requestCommands,
  requestModels,
  requestUsage,
  respondPermission,
  restartChat,
  sendChat,
  setChatEffort,
  setChatMode,
  setChatModel,
  setChatUltracode,
  suspendChat,
  useClaudeChatStore,
  useQoderChatStore,
} from "./claudeChatStore";
import {
  compactCodex,
  ensureCodexChat,
  interruptCodex,
  requestCodexCommands,
  requestCodexModels,
  requestCodexUsage,
  respondCodexPermission,
  restartCodex,
  sendCodex,
  setCodexEffort,
  setCodexMode,
  setCodexModel,
  setCodexServiceTier,
  suspendCodex,
  useCodexChatStore,
} from "./codexChatStore";

export type ChatAgent = "claude" | "codex" | "qoder";

/** 起会话时的选项;平时都不传,从云效任务开工时才用。 */
export type ChatStartOpts = {
  /** 不接这个目录上次的会话,开一个全新的。 */
  fresh?: boolean;
  /** 只给这个窗格的会话用的权限模式,不记成以后新会话的默认。 */
  permissionMode?: string;
};

/** 聊天视图对一个会话能做的事;Claude 和 Codex 各一份,界面不用分辨。 */
export type ChatApi = {
  ensure: (leafId: number, cwd: string, opts?: ChatStartOpts) => void;
  send: (leafId: number, text: string, attachments: string[]) => void;
  respond: (
    leafId: number,
    id: string,
    allow: boolean,
    always?: boolean,
    /** 改过的工具参数(AskUserQuestion 的回答放这里)。 */
    updatedInput?: Record<string, unknown>,
    /** 拒绝时带给 AI 的话(比如对计划的修改意见)。 */
    message?: string,
  ) => void;
  interrupt: (leafId: number) => void;
  setModel: (leafId: number, model: string) => void;
  setMode: (leafId: number, mode: string) => void;
  requestModels: (leafId: number) => void;
  requestUsage: (leafId: number) => void;
  /** 拉一次输入 / (Codex 是 $)能选的技能和命令。 */
  requestCommands: (leafId: number) => void;
  compact: (leafId: number) => void;
  /** 换新会话;启动失败重试也用它(会清掉排队的旧消息,不会重发)。 */
  restart: (
    leafId: number,
    cwd: string,
    opts?: Pick<ChatStartOpts, "permissionMode">,
  ) => void;
  /** 会话交给命令行:停掉聊天这边的进程,记录留着以后接着读。 */
  suspend: (leafId: number) => void;
  /** 推理强度:Claude、Codex 有;快速档只有 Codex。 */
  setEffort?: (leafId: number, effort: string) => void;
  /** ultracode 开关:只有 Claude 有,和强度分开。 */
  setUltracode?: (leafId: number, on: boolean) => void;
  setServiceTier?: (leafId: number, tier: string) => void;
};

export const CHAT_APIS: Record<ChatAgent, ChatApi> = {
  claude: {
    ensure: (leafId, cwd, opts) =>
      ensureChat(leafId, cwd, opts?.fresh, opts?.permissionMode),
    send: sendChat,
    respond: respondPermission,
    interrupt: interruptChat,
    setModel: setChatModel,
    setMode: setChatMode,
    requestModels,
    requestUsage,
    requestCommands,
    compact: (leafId) => sendChat(leafId, "/compact"),
    restart: restartChat,
    suspend: suspendChat,
    setEffort: setChatEffort,
    setUltracode: setChatUltracode,
  },
  codex: {
    ensure: (leafId, cwd, opts) =>
      ensureCodexChat(leafId, cwd, opts?.fresh, opts?.permissionMode),
    send: sendCodex,
    respond: respondCodexPermission,
    interrupt: interruptCodex,
    setModel: setCodexModel,
    setMode: setCodexMode,
    requestModels: requestCodexModels,
    requestUsage: requestCodexUsage,
    requestCommands: requestCodexCommands,
    compact: compactCodex,
    restart: restartCodex,
    suspend: suspendCodex,
    setEffort: setCodexEffort,
    setServiceTier: setCodexServiceTier,
  },
  qoder: {
    ensure: (leafId, cwd, opts) =>
      qoderChat.ensureChat(leafId, cwd, opts?.fresh, opts?.permissionMode),
    send: qoderChat.sendChat,
    respond: qoderChat.respondPermission,
    interrupt: qoderChat.interruptChat,
    setModel: qoderChat.setChatModel,
    setMode: qoderChat.setChatMode,
    requestModels: qoderChat.requestModels,
    requestUsage: qoderChat.requestUsage,
    requestCommands: qoderChat.requestCommands,
    compact: (leafId) => qoderChat.sendChat(leafId, "/compact"),
    restart: qoderChat.restartChat,
    suspend: qoderChat.suspendChat,
  },
};

export const AGENT_NAMES: Record<ChatAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  qoder: "Qoder",
};

function storeOf(agent: ChatAgent) {
  return agent === "codex"
    ? useCodexChatStore
    : agent === "qoder"
      ? useQoderChatStore
      : useClaudeChatStore;
}

/**
 * 窗格没了(tab 关了):停掉它名下的聊天进程。不停的话它会在后台接着跑、
 * 接着改文件,权限请求也没人看得见;再从任务开工就成了两个会话改同一个
 * worktree。会话记录留着,以后在这个目录还能接着聊。
 */
export function stopLeafChats(leafId: number): void {
  for (const agent of Object.keys(CHAT_APIS) as ChatAgent[]) {
    if (chatSessionNow(agent, leafId)) CHAT_APIS[agent].suspend(leafId);
  }
}

/** 这个窗格眼下的聊天会话(不订阅,事件处理里用)。 */
export function chatSessionNow(
  agent: ChatAgent,
  leafId: number,
): ChatSession | undefined {
  return storeOf(agent).getState().sessions[leafId];
}

/** 盯着这个窗格的会话变化(组件外用,比如等它起来或报错);返回取消订阅。 */
export function subscribeChatSession(
  agent: ChatAgent,
  leafId: number,
  fn: (session: ChatSession | undefined) => void,
): () => void {
  return storeOf(agent).subscribe((s, prev) => {
    if (s.sessions[leafId] !== prev.sessions[leafId]) fn(s.sessions[leafId]);
  });
}

/** 这个窗格在用的那个聊天会话。 */
export function useChatSession(
  agent: ChatAgent,
  leafId: number,
): ChatSession | undefined {
  const claude = useClaudeChatStore((s) => s.sessions[leafId]);
  const codex = useCodexChatStore((s) => s.sessions[leafId]);
  const qoder = useQoderChatStore((s) => s.sessions[leafId]);
  return agent === "codex" ? codex : agent === "qoder" ? qoder : claude;
}
