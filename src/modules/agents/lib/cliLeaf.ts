import type { CliAgent } from "../store/agentViewStore";

const CLI_AGENTS: CliAgent[] = ["claude", "codex", "qoder"];
/** 普通窗格 id 是从小往上数的计数,命令行终端的 id 放到远处,撞不上。 */
const CLI_BASE = 1_000_000_000;

/** 窗格 leafId 里跑某个 AI 命令行的那个终端的 id(每个 AI 一个)。 */
export function cliLeafId(leafId: number, agent: CliAgent): number {
  return CLI_BASE + leafId * CLI_AGENTS.length + CLI_AGENTS.indexOf(agent);
}

/** 这个窗格名下所有可能的命令行终端 id(窗格关掉时一起收)。 */
export function cliLeafIds(leafId: number): number[] {
  return CLI_AGENTS.map((a) => cliLeafId(leafId, a));
}

/** 会话 id 要拼进终端命令,只认字母数字和 -_,别的一律不接。 */
export function isSafeSessionId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

/** 命令行还没跑起来:带上"接着这个会话"启动。 */
export function resumeLaunchCommand(
  agent: CliAgent,
  base: string,
  sessionId: string,
): string {
  return agent === "codex"
    ? `${base} resume ${sessionId}`
    : `${base} --resume ${sessionId}`;
}

/** 命令行里 AI 已经在跑:在它里面切到这个会话;Codex 的 /resume 不接 id,切不了。 */
export function resumeInCliInput(
  agent: CliAgent,
  sessionId: string,
): string | null {
  return agent === "codex" ? null : `/resume ${sessionId}\r`;
}
