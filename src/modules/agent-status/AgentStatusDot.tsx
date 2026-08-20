import { cn } from "@/lib/utils";
import { tabAgentStatus, useAgentActivityStore } from "@/modules/terminal";

type Props = {
  projectRoot: string | null;
  /** projectRoot -> pty ids across every terminal tab open on that project. */
  projectPtyIds: Record<string, number[]>;
  className?: string;
};

const STATE_LABEL: Record<string, string> = {
  working: "Claude Code 运行中",
  attention: "Claude Code 需要确认",
  finished: "Claude Code 已完成",
};

// 黄灯:进行中。红灯(闪烁):需要确认。绿灯:已完成。
const STATE_EMOJI: Record<string, string> = {
  working: "🟡",
  attention: "🔴",
  finished: "🟢",
};

export type AgentPhaseState = "working" | "attention" | "finished";

/** A project's aggregate Claude Code / Codex / Gemini state, derived from the
 * same OSC 777 detection signal the tab bar icon already uses. */
export function useProjectAgentState(
  projectRoot: string | null,
  projectPtyIds: Record<string, number[]>,
): AgentPhaseState | null {
  const phases = useAgentActivityStore((s) => s.phases);
  const agents = useAgentActivityStore((s) => s.agents);
  if (!projectRoot) return null;
  const ptyIds = projectPtyIds[projectRoot];
  if (!ptyIds || ptyIds.length === 0) return null;
  return (tabAgentStatus(phases, agents, ptyIds).state as AgentPhaseState) ?? null;
}

/** Traffic-light emoji badge for a project's agent activity. */
export function AgentStatusDot({ projectRoot, projectPtyIds, className }: Props) {
  const state = useProjectAgentState(projectRoot, projectPtyIds);
  if (!state) return null;
  return (
    <span
      title={STATE_LABEL[state]}
      className={cn(
        "inline-block shrink-0 leading-none",
        state === "attention" && "animate-pulse",
        className,
      )}
    >
      {STATE_EMOJI[state]}
    </span>
  );
}
