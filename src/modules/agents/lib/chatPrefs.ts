import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ChatAgent } from "../store/chatProviders";

/*
 * 按目录记的聊天偏好(上次是聊天还是终端、用的哪个 AI)。窗格切换和
 * 从云效任务开工都要读写,所以放在这里共用;localStorage 的 key 不能改,
 * 改了用户以前记下的就都丢了。
 */

const viewKey = (cwd: string) => `terax.chat.view:${cwd}`;

/** 这个目录上次是聊天还是终端;重开窗格时照着恢复。 */
export function savedView(cwd: string): "chat" | "terminal" | null {
  try {
    const v = localStorage.getItem(viewKey(cwd));
    return v === "chat" || v === "terminal" ? v : null;
  } catch {
    return null;
  }
}

export function saveView(cwd: string | null, view: "chat" | "terminal") {
  if (!cwd) return;
  try {
    localStorage.setItem(viewKey(cwd), view);
  } catch {}
}

const agentKey = (cwd: string) => `terax.chat.agent:${cwd}`;

/** 这个目录上次聊天用的是 Claude 还是 Codex。 */
export function savedAgent(cwd: string | null): ChatAgent | null {
  if (!cwd) return null;
  try {
    const v = localStorage.getItem(agentKey(cwd));
    return v === "claude" || v === "codex" || v === "qoder" ? v : null;
  } catch {
    return null;
  }
}

export function saveAgent(cwd: string | null, agent: ChatAgent) {
  if (!cwd) return;
  try {
    localStorage.setItem(agentKey(cwd), agent);
  } catch {}
}

/**
 * 在这个目录新开聊天用谁:这个目录上次用的 > 设置里的默认。
 * 没有窗格可看(还没开 tab),所以不管"终端里正在跑的"那一层。
 */
export function pickChatAgent(cwd: string): ChatAgent {
  return savedAgent(cwd) ?? usePreferencesStore.getState().defaultChatAgent;
}
