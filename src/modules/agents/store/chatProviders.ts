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
  setChatMode,
  setChatModel,
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

/** 聊天视图对一个会话能做的事;Claude 和 Codex 各一份,界面不用分辨。 */
export type ChatApi = {
  ensure: (leafId: number, cwd: string) => void;
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
  restart: (leafId: number, cwd: string) => void;
  /** 会话交给命令行:停掉聊天这边的进程,记录留着以后接着读。 */
  suspend: (leafId: number) => void;
  /** 推理强度、快速档:只有 Codex 有。 */
  setEffort?: (leafId: number, effort: string) => void;
  setServiceTier?: (leafId: number, tier: string) => void;
};

export const CHAT_APIS: Record<ChatAgent, ChatApi> = {
  claude: {
    ensure: (leafId, cwd) => ensureChat(leafId, cwd),
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
  },
  codex: {
    ensure: (leafId, cwd) => ensureCodexChat(leafId, cwd),
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
    ensure: (leafId, cwd) => qoderChat.ensureChat(leafId, cwd),
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

/** 这个窗格眼下的聊天会话(不订阅,事件处理里用)。 */
export function chatSessionNow(
  agent: ChatAgent,
  leafId: number,
): ChatSession | undefined {
  const store =
    agent === "codex"
      ? useCodexChatStore
      : agent === "qoder"
        ? useQoderChatStore
        : useClaudeChatStore;
  return store.getState().sessions[leafId];
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
