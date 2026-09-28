import {
  type ChatSession,
  ensureChat,
  interruptChat,
  requestModels,
  requestUsage,
  respondPermission,
  restartChat,
  sendChat,
  setChatMode,
  setChatModel,
  useClaudeChatStore,
} from "./claudeChatStore";
import {
  compactCodex,
  ensureCodexChat,
  interruptCodex,
  requestCodexModels,
  requestCodexUsage,
  respondCodexPermission,
  restartCodex,
  sendCodex,
  setCodexEffort,
  setCodexMode,
  setCodexModel,
  setCodexServiceTier,
  useCodexChatStore,
} from "./codexChatStore";

export type ChatAgent = "claude" | "codex";

/** 聊天视图对一个会话能做的事;Claude 和 Codex 各一份,界面不用分辨。 */
export type ChatApi = {
  ensure: (leafId: number, cwd: string) => void;
  send: (leafId: number, text: string, attachments: string[]) => void;
  respond: (
    leafId: number,
    id: string,
    allow: boolean,
    always?: boolean,
  ) => void;
  interrupt: (leafId: number) => void;
  setModel: (leafId: number, model: string) => void;
  setMode: (leafId: number, mode: string) => void;
  requestModels: (leafId: number) => void;
  requestUsage: (leafId: number) => void;
  compact: (leafId: number) => void;
  restart: (leafId: number, cwd: string) => void;
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
    compact: (leafId) => sendChat(leafId, "/compact"),
    restart: restartChat,
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
    compact: compactCodex,
    restart: restartCodex,
    setEffort: setCodexEffort,
    setServiceTier: setCodexServiceTier,
  },
};

export const AGENT_NAMES: Record<ChatAgent, string> = {
  claude: "Claude",
  codex: "Codex",
};

/** 这个窗格在用的那个聊天会话。 */
export function useChatSession(
  agent: ChatAgent,
  leafId: number,
): ChatSession | undefined {
  const claude = useClaudeChatStore((s) => s.sessions[leafId]);
  const codex = useCodexChatStore((s) => s.sessions[leafId]);
  return agent === "codex" ? codex : claude;
}
