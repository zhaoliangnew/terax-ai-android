import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  coerceVisibleChatAgents,
  firstVisibleChatAgent,
  PANE_AGENTS,
  type PaneAgent,
} from "@/modules/settings/store";
import type { ChatAgent } from "../store/chatProviders";

/*
 * 按目录记的聊天偏好(用的哪个 AI)。窗格切换和
 * 从云效任务开工都要读写,所以放在这里共用;localStorage 的 key 不能改,
 * 改了用户以前记下的就都丢了。
 */

const agentKey = (cwd: string) => `terax.chat.agent:${cwd}`;

/** 这个目录上次在窗格里用的哪个 AI(可能是只有命令行的)。 */
export function savedAgent(cwd: string | null): PaneAgent | null {
  if (!cwd) return null;
  try {
    const v = localStorage.getItem(agentKey(cwd));
    return PANE_AGENTS.find((a) => a === v) ?? null;
  } catch {
    return null;
  }
}

export function saveAgent(cwd: string | null, agent: PaneAgent) {
  if (!cwd) return;
  try {
    localStorage.setItem(agentKey(cwd), agent);
  } catch {}
}

/** 设置里没关掉这个 AI。 */
export function isChatAgentEnabled(agent: ChatAgent): boolean {
  return coerceVisibleChatAgents(
    usePreferencesStore.getState().visibleChatAgents,
  ).includes(agent);
}

/**
 * 在这个目录新开聊天用谁:这个目录上次用的 > 设置里的默认,只从设置里显示的 AI 里挑。
 * 没有窗格可看(还没开 tab),所以不管"终端里正在跑的"那一层。
 */
export function pickChatAgent(cwd: string): ChatAgent {
  const { defaultChatAgent, visibleChatAgents } =
    usePreferencesStore.getState();
  return firstVisibleChatAgent(
    [savedAgent(cwd), defaultChatAgent],
    visibleChatAgents,
  );
}
