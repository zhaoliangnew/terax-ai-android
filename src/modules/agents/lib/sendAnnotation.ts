import { writeToSession } from "@/modules/terminal/lib/useTerminalSession";
import { type InjectionItem, useAgentViewStore } from "../store/agentViewStore";
import { cliLeafId } from "./cliLeaf";

/**
 * 把一组批注(投屏 / 网页)交给当前窗格里的 AI:
 * - 聊天视图:挂成输入框上方的"N 条注释",发送时并进消息;
 * - 命令行视图:整段贴进命令行的输入框(带截图路径),不替你按回车。
 * 返回落到了哪里;都不在就是 null。
 */
export function sendAnnotation(
  text: string,
  attachments: string[],
  items: InjectionItem[],
): "chat" | "cli" | null {
  const store = useAgentViewStore.getState();
  if (store.activeChatLeaf != null) {
    store.injectToChat(store.activeChatLeaf, text, attachments, items);
    return "chat";
  }
  const leafId = store.activeCliLeaf;
  if (leafId == null) return null;
  const opened = store.clis[leafId] ?? [];
  const picked = store.agents[leafId];
  const agent = picked && opened.includes(picked) ? picked : opened[0];
  if (!agent) return null;
  const body = attachments.length
    ? `${text}\n\n截图:\n${attachments.join("\n")}`
    : text;
  // 括号粘贴:多行当一整段贴进去,不会每行被当成一次回车
  return writeToSession(cliLeafId(leafId, agent), `\x1b[200~${body}\x1b[201~`)
    ? "cli"
    : null;
}
