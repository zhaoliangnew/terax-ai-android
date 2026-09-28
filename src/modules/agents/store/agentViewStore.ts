import { create } from "zustand";
import type { ChatAgent } from "./chatProviders";

export type AgentViewMode = "chat" | "terminal";

/** 每个终端窗格显示成聊天视图还是原始终端。没切过的就是终端。 */
type AgentViewStore = {
  modes: Record<number, AgentViewMode>;
  setMode: (leafId: number, mode: AgentViewMode) => void;
  /** 聊天里选中文字点"添加到对话":交给同一窗格的输入框(n 递增当信号)。 */
  quotes: Record<number, { text: string; n: number }>;
  addQuote: (leafId: number, text: string) => void;
  /** 窗格里手动选过的聊天对象;没选过的按终端里在跑的 agent 自动判断。 */
  agents: Record<number, ChatAgent>;
  setAgent: (leafId: number, agent: ChatAgent) => void;
};

export const useAgentViewStore = create<AgentViewStore>((set) => ({
  modes: {},
  quotes: {},
  agents: {},
  setAgent: (leafId, agent) =>
    set((s) =>
      s.agents[leafId] === agent
        ? s
        : { agents: { ...s.agents, [leafId]: agent } },
    ),
  addQuote: (leafId, text) =>
    set((s) => ({
      quotes: {
        ...s.quotes,
        [leafId]: { text, n: (s.quotes[leafId]?.n ?? 0) + 1 },
      },
    })),
  setMode: (leafId, mode) =>
    set((s) =>
      s.modes[leafId] === mode ? s : { modes: { ...s.modes, [leafId]: mode } },
    ),
}));
