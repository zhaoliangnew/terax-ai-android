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
