import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { pickChatAgent } from "@/modules/agents/lib/chatPrefs";
import { TASK_PERMISSION_LABEL } from "@/modules/agents/lib/startChatTask";
import {
  AGENT_NAMES,
  type ChatAgent,
} from "@/modules/agents/store/chatProviders";
import { useEffect, useRef, useState } from "react";
import type { Workitem } from "./lib/codeupApi";
import {
  probeTaskWorktree,
  type TaskWorktreeProbe,
  taskWorktreeBranch,
} from "./lib/workitemLaunch";
import { PaneOverlay } from "./WorkitemRepoPicker";

const WORKFLOW = "leniu-android-dev-workflow-fast";

type Probe = TaskWorktreeProbe & {
  /** 两种开发位置各自会用哪个 AI(按目录记的,可能不一样)。 */
  agentInWorktree: ChatAgent;
  agentInRepo: ChatAgent;
};

/** 探测失败时按最保守的来:当它不是 git 仓库,不给建 worktree。 */
const UNKNOWN: TaskWorktreeProbe = {
  isRepo: false,
  branch: null,
  state: "none",
  devDir: null,
  taskBranch: "",
};

/** worktree 那一项在各种状态下的标题、说明,以及能不能选。 */
function worktreeChoice(
  probe: Probe | null,
  wtBranch: string | null,
  branchLabel: string,
): { title: string; detail: string; disabled: boolean } {
  if (!wtBranch) {
    return {
      title: "在新 worktree 里开发",
      detail: "这条没有编号,没法按编号建 worktree",
      disabled: true,
    };
  }
  if (!probe) {
    return {
      title: "在新 worktree 里开发(推荐)",
      detail: "…",
      disabled: false,
    };
  }
  if (!probe.isRepo) {
    return {
      title: "在新 worktree 里开发",
      detail: "这个目录不在 git 仓库里(或读不到 git),没法建 worktree",
      disabled: true,
    };
  }
  switch (probe.state) {
    case "worktree":
      return {
        title: "复用这条任务已有的 worktree",
        detail: `${probe.devDir}(分支 ${wtBranch})`,
        disabled: false,
      };
    case "branch":
      return {
        title: `把已有分支 ${wtBranch} 挂回 worktree(推荐)`,
        detail:
          "分支还在,可能有上次的提交:原样挂到 .worktree/ 下接着做,不新建、不删分支",
        disabled: false,
      };
    case "missing":
      return {
        title: "重新挂回这条任务的 worktree(推荐)",
        detail: `原来的目录不在了:清掉 git 里的旧记录,再把分支 ${wtBranch} 挂回来,之前的提交都在`,
        disabled: false,
      };
    case "head":
      return {
        title: "在 worktree 里开发",
        detail: `仓库当前就切在 ${wtBranch} 上,同一个分支没法再挂一份 worktree`,
        disabled: true,
      };
    default:
      return {
        title: "在新 worktree 里开发(推荐)",
        detail: `分支/目录 ${wtBranch},基于当前分支 ${branchLabel}`,
        disabled: false,
      };
  }
}

/**
 * 开工前的确认面板:在哪开发、用哪个 AI、什么权限、走哪个流程,
 * 全部摆出来再让用户点「开始开发」。点之前什么都不动(不建 worktree、
 * 不拉需求、不开 tab)。
 */
export function TaskLaunchConfirm({
  item,
  repoRoot,
  busy,
  onCancel,
  onChangeRepo,
  onStart,
}: {
  item: Workitem;
  repoRoot: string;
  /** 正在做的那一步(建 worktree… / 拉需求…);null 表示还没开始。 */
  busy: string | null;
  onCancel: () => void;
  onChangeRepo: () => void;
  onStart: (useWorktree: boolean) => void;
}) {
  const serial = item.serialNumber;
  const [probe, setProbe] = useState<Probe | null>(null);
  // 显示的分支名:已有的按实际名字(标题改过也认得出),没有就是将要建的
  // worktree_<编号>_<标题>(Windows 只留编号)
  const wtBranch = serial
    ? probe?.taskBranch || taskWorktreeBranch(serial, item.subject, IS_WINDOWS)
    : null;
  const [useWorktree, setUseWorktree] = useState(!!serial);
  const choicesRef = useRef<HTMLFieldSetElement>(null);

  // 分支、任务分支状态、按目录记的 AI 都是副作用读,放 effect 里
  // (React Compiler 会把渲染期读到的 localStorage 记忆化)
  useEffect(() => {
    let alive = true;
    setProbe(null);
    probeTaskWorktree(repoRoot, serial, item.subject)
      .catch(() => UNKNOWN)
      .then((p) => {
        if (!alive) return;
        // 新 worktree 还没建出来,按它将来的路径取,取不到就是设置里的默认
        setProbe({
          ...p,
          agentInWorktree: pickChatAgent(p.devDir ?? repoRoot),
          agentInRepo: pickChatAgent(repoRoot),
        });
        // 不是 git 仓库、或主仓库本身就切在任务分支上:worktree 建不了,
        // 别让用户点了才报错
        if (!serial || !p.isRepo || p.state === "head") setUseWorktree(false);
      });
    return () => {
      alive = false;
    };
  }, [repoRoot, serial, item.subject]);

  // 面板一出来就把焦点放到选中的那一项,键盘用户不用先 Tab 穿过左边整张
  // 项目列表;探测完把 worktree 那项禁掉时,焦点跟着挪到能选的那项。
  // 用户已经把焦点挪到别处(比如 Tab 到按钮上)就不抢
  useEffect(() => {
    const active = document.activeElement;
    const lost =
      !probe ||
      !active ||
      active === document.body ||
      (active instanceof HTMLInputElement && active.disabled);
    if (!lost) return;
    choicesRef.current
      ?.querySelector<HTMLInputElement>("input:checked:not(:disabled)")
      ?.focus();
  }, [probe]);

  // 读不到分支名(detached)时 worktree 是基于 HEAD 建
  const branchLabel = probe ? (probe.branch ?? "HEAD") : "…";
  const wt = worktreeChoice(probe, wtBranch, branchLabel);
  const worktreeOn = useWorktree && !wt.disabled;
  const agent = probe
    ? worktreeOn
      ? probe.agentInWorktree
      : probe.agentInRepo
    : null;
  const busyNow = busy !== null;

  return (
    <PaneOverlay onDismiss={busyNow ? undefined : onCancel}>
      <div className="shrink-0 border-b border-border/60 px-3 pt-2.5 pb-2">
        <div className="text-[12.5px] font-semibold">让 AI 开发这条</div>
        <div
          className="mt-0.5 truncate text-[12px] text-foreground/85"
          title={item.subject}
        >
          <span className="text-muted-foreground/70">
            {serial ? `#${serial} ` : ""}
          </span>
          {item.subject}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5 text-[12px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-10 shrink-0 text-[11px] text-muted-foreground">
            仓库
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11.5px]"
            title={repoRoot}
          >
            {repoRoot}
          </span>
          <button
            type="button"
            disabled={busyNow}
            onClick={onChangeRepo}
            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            换仓库
          </button>
        </div>

        {/* fieldset 默认 min-inline-size: min-content,不清掉的话长路径会把面板撑出横向滚动 */}
        <fieldset
          ref={choicesRef}
          disabled={busyNow}
          className="flex min-w-0 flex-col gap-1.5"
        >
          <legend className="sr-only">在哪开发</legend>
          <ChoiceRow
            checked={worktreeOn}
            disabled={wt.disabled}
            onSelect={() => setUseWorktree(true)}
            title={wt.title}
            detail={wt.detail}
          />
          <ChoiceRow
            checked={!worktreeOn}
            onSelect={() => setUseWorktree(false)}
            title={
              !probe || probe.isRepo
                ? `直接在当前分支 ${branchLabel} 开发`
                : "直接在这个目录开发"
            }
            detail={
              probe && !probe.isRepo
                ? "不在 git 仓库里,改动没有分支隔离"
                : probe?.state === "head"
                  ? "当前分支就是这条任务的分支"
                  : "会和你手头未提交的改动混在一起"
            }
          />
        </fieldset>

        <div className="flex flex-col gap-1 rounded-md bg-foreground/5 px-2.5 py-2 text-[11.5px]">
          <InfoLine label="AI" value={agent ? AGENT_NAMES[agent] : "…"} />
          <InfoLine
            label="权限"
            value={agent ? TASK_PERMISSION_LABEL[agent] : "…"}
          />
          <InfoLine label="流程" value={WORKFLOW} mono />
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground/80">
          会新开一个 tab 进入聊天,把云效上的需求内容作为第一条消息发出去。
          这个权限只用在这条任务的窗格和会话上,不改你平时的默认;
          不会改云效上的状态。
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          取消
        </Button>
        <Button
          size="sm"
          disabled={busyNow || !probe}
          onClick={() => onStart(worktreeOn && !!wtBranch)}
          className="h-7 min-w-24 text-xs"
        >
          {busyNow ? (
            <>
              <Spinner className="size-3" />
              {busy}
            </>
          ) : (
            "开始开发"
          )}
        </Button>
      </div>
    </PaneOverlay>
  );
}

function ChoiceRow({
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
        checked
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-border/60 hover:bg-foreground/5",
        disabled && "cursor-default opacity-50",
      )}
    >
      <input
        type="radio"
        name="task-dev-location"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 accent-emerald-500"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[12px] text-foreground/90">{title}</span>
        <span
          className="truncate text-[10.5px] text-muted-foreground"
          title={detail}
        >
          {detail}
        </span>
      </span>
    </label>
  );
}

function InfoLine({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-8 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate", mono && "font-mono")}>
        {value}
      </span>
    </div>
  );
}
