import { cn } from "@/lib/utils";
import {
  Delete02Icon,
  Exchange01Icon,
  PackageMovingIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  /** 当前终端里跑着的 agent 名(agentActivity 记的那个)。 */
  agent: string;
  /** 把一行(带回车)打进当前终端。 */
  onRun: (line: string) => void;
};

/**
 * 认这几个 agent —— 它们的 `/model`、`/compact`、`/clear` 是一样的意思。
 *
 * Codex 那三条是从客户端二进制里核过的(0.147.0):`/model` = pick a different
 * model、`/compact` = summarize history、`/clear` 也在。别照着印象加新 agent,
 * 打错的斜杠命令会被当成普通输入发给模型。
 */
const SUPPORTED = new Set(["claude", "codex"]);

export function supportsSessionActions(agent: string | null): boolean {
  return agent !== null && SUPPORTED.has(agent);
}

const BUTTON =
  "flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/**
 * 当前终端里跑着 Claude / Codex 时,底栏给三个最常用的斜杠命令留个按钮。
 *
 * 就是把 `/model`、`/compact`、`/clear` 打进去回车 —— 手敲也一样,只是这三条
 * 一天要用很多次,不值当每次都切回键盘拼。跑着别的 agent(或者压根没跑)时
 * 整组不显示,免得把命令打进 shell 里。
 */
export function AgentSessionActions({ agent, onRun }: Props) {
  const who = agent === "codex" ? "Codex" : "Claude";
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        title={`切换模型 · ${who} /model`}
        onClick={() => onRun("/model\r")}
        className={BUTTON}
      >
        <HugeiconsIcon icon={Exchange01Icon} size={12} strokeWidth={1.75} />
        {/* 挤到只剩一行放不下时只留图标,tooltip 里还有全称。 */}
        <span className="@max-[400px]:hidden">切换模型</span>
      </button>
      <button
        type="button"
        title={`压缩上下文 · ${who} /compact`}
        onClick={() => onRun("/compact\r")}
        className={BUTTON}
      >
        <HugeiconsIcon icon={PackageMovingIcon} size={12} strokeWidth={1.75} />
        <span className="@max-[400px]:hidden">压缩上下文</span>
      </button>
      <button
        type="button"
        // 点下去就没了,没有二次确认 —— 所以给个红色的 hover,别跟旁边两个一样。
        title={`清空上下文 · ${who} /clear(立即执行,不可撤销)`}
        onClick={() => onRun("/clear\r")}
        className={cn(BUTTON, "hover:bg-red-500/10 hover:text-red-400")}
      >
        <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
        <span className="@max-[400px]:hidden">清空上下文</span>
      </button>
    </span>
  );
}
