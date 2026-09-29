import { create } from "zustand";
import type { ChatAgent } from "./chatProviders";

/** 聊天(聊天界面)、命令行(窗格里单独的终端跑 AI 命令行版)、终端(原来的 shell)。 */
export type AgentViewMode = "chat" | "cli" | "terminal";

/** 命令行能跑的 AI(和聊天是同一组)。 */
export type CliAgent = ChatAgent;

/** 一条批注:给"N 条注释"展开的卡片显示。 */
export type InjectionItem = { thumb: string; note: string };

/** 从投屏批注注入聊天的一组批注(n 递增当信号)。挂成"N 条注释"列表条,
 * 不直接塞进输入框;发送时并进消息。 */
export type ChatInjection = {
  /** 发送时并进消息的整段文字。 */
  text: string;
  attachments: string[];
  /** 每条批注(缩略图 + 说明),给芯片展开成卡片。 */
  items: InjectionItem[];
  n: number;
};

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
  /** 窗格里已经开过命令行的 AI(各自一个终端,切走不关)。 */
  clis: Record<number, CliAgent[]>;
  openCli: (leafId: number, agent: CliAgent) => void;
  /** 当前正处于聊天视图、并且是焦点窗格的那个;投屏批注往这里发。 */
  activeChatLeaf: number | null;
  setActiveChatLeaf: (leafId: number | null) => void;
  /** 当前正处于命令行视图、并且是焦点窗格的那个;没有聊天时批注贴到这里。 */
  activeCliLeaf: number | null;
  setActiveCliLeaf: (leafId: number | null) => void;
  /** 往某个窗格挂一组投屏批注(文字 + 截图 + 每条明细)。 */
  injections: Record<number, ChatInjection>;
  injectToChat: (
    leafId: number,
    text: string,
    attachments: string[],
    items: InjectionItem[],
  ) => void;
};

export const useAgentViewStore = create<AgentViewStore>((set) => ({
  modes: {},
  quotes: {},
  agents: {},
  clis: {},
  activeChatLeaf: null,
  activeCliLeaf: null,
  setActiveCliLeaf: (leafId) =>
    set((s) => (s.activeCliLeaf === leafId ? s : { activeCliLeaf: leafId })),
  openCli: (leafId, agent) =>
    set((s) => {
      const cur = s.clis[leafId] ?? [];
      return cur.includes(agent)
        ? s
        : { clis: { ...s.clis, [leafId]: [...cur, agent] } };
    }),
  injections: {},
  setActiveChatLeaf: (leafId) =>
    set((s) => (s.activeChatLeaf === leafId ? s : { activeChatLeaf: leafId })),
  injectToChat: (leafId, text, attachments, items) =>
    set((s) => ({
      injections: {
        ...s.injections,
        [leafId]: {
          text,
          attachments,
          items,
          n: (s.injections[leafId]?.n ?? 0) + 1,
        },
      },
    })),
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
