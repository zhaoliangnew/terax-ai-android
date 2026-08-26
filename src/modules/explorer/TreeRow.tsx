import { cn } from "@/lib/utils";
import {
  type AgentPhaseState,
  useProjectAgentState,
} from "@/modules/agent-status/AgentStatusDot";
import {
  getCodeupOrgId,
  getProjectLink,
  openExternally,
  type ProjectKind,
  projexUrl,
} from "@/modules/android-run";
import { WorktreeCountBadge } from "@/modules/android-run/BranchChip";
import {
  AndroidIcon,
  ArrowRight01Icon,
  CloudIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { InlineInput } from "./InlineInput";
import { explorerGitTextClass } from "./lib/gitStatusColor";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl, namedIconUrl } from "./lib/iconResolver";

const AGENT_STATE_EMOJI: Record<AgentPhaseState, string> = {
  working: "🟡",
  attention: "🔴",
  finished: "🟢",
};
const AGENT_STATE_LABEL: Record<AgentPhaseState, string> = {
  working: "Claude Code 运行中",
  attention: "Claude Code 需要确认",
  finished: "Claude Code 已完成",
};

export type RowActions = {
  toggle: (path: string) => void;
  beginRename: (path: string) => void;
  commitRename: (newName: string) => void | Promise<void>;
  cancelRename: () => void;
};

export type EntryRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  isExpanded: boolean;
  depth: number;
  actions: RowActions;
  renameInProgress: boolean;
  isSelected: boolean;
  isRenaming: boolean;
  isDropTarget?: boolean;
  onOpenFile: (path: string, pin?: boolean) => void;
  onSelectPath: (path: string) => void;
  gitStatusCode?: GitStatusCode | null;
  gitignored?: boolean;
  /** 工程目录(安卓/Flutter):显示对应图标、不可展开、点击直接开/定位终端。 */
  projectKind?: ProjectKind | null;
  onOpenProject?: (path: string) => void;
  /** 当前打开的产品:用醒目底色高亮。 */
  isActiveProject?: boolean;
  /** 已有终端 tab 打开的工程:用绿字标出。 */
  isOpenedProject?: boolean;
  /** 工程根 -> 该工程下所有终端 tab 的 pty id,驱动 Claude Code 状态灯。 */
  projectPtyIds?: Record<string, number[]>;
  /** 这个目录本身绑了云效项目,行尾挂个云图标(不含从父目录继承的)。 */
  yunxiaoLinked?: boolean;
};

function EntryRowImpl(props: EntryRowProps) {
  const {
    path,
    name,
    isDir,
    isExpanded,
    depth,
    actions,
    renameInProgress,
    isSelected,
    isRenaming,
    isDropTarget = false,
    onOpenFile,
    onSelectPath,
    gitStatusCode,
    gitignored = false,
    projectKind = null,
    onOpenProject,
    isActiveProject = false,
    isOpenedProject = false,
    projectPtyIds,
    yunxiaoLinked = false,
  } = props;

  const asProject = projectKind !== null && !!onOpenProject;
  const iconUrl = isDir ? folderIconUrl(name, isExpanded) : fileIconUrl(name);
  const paddingLeft = 6 + depth * 12;
  const agentState = useProjectAgentState(
    asProject ? path : null,
    projectPtyIds ?? {},
  );

  if (isRenaming) {
    return (
      <div
        className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
        style={{ paddingLeft }}
      >
        <span className="size-3.5 shrink-0" />
        {iconUrl ? (
          <img src={iconUrl} alt="" className="size-4 shrink-0" />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <InlineInput
          initial={name}
          onCommit={actions.commitRename}
          onCancel={actions.cancelRename}
        />
      </div>
    );
  }

  const handleClick = () => {
    if (renameInProgress) return;
    onSelectPath(path);
    if (asProject) onOpenProject?.(path);
    else if (isDir) actions.toggle(path);
    else onOpenFile(path);
  };

  return (
    <button
      type="button"
      data-fs-path={path}
      onClick={handleClick}
      onDoubleClick={() => !isDir && actions.beginRename(path)}
      className={cn(
        "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/70",
        isActiveProject
          ? "bg-emerald-500/15 font-semibold text-emerald-400"
          : isSelected
            ? "bg-accent text-foreground"
            : gitignored
              ? "text-muted-foreground/70"
              : "text-foreground/85",
        isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/60",
      )}
      style={{ paddingLeft }}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {isDir && !asProject ? (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            strokeWidth={2.25}
            className={cn("transition-transform", isExpanded && "rotate-90")}
          />
        ) : null}
      </span>
      {asProject ? (
        agentState ? (
          <span
            title={AGENT_STATE_LABEL[agentState]}
            className={cn(
              "inline-block size-4 shrink-0 text-center text-[13px] leading-4",
              agentState === "attention" && "animate-pulse",
            )}
          >
            {AGENT_STATE_EMOJI[agentState]}
          </span>
        ) : projectKind === "flutter" ? (
          <img
            src={namedIconUrl("flutter") ?? ""}
            alt=""
            className="size-4 shrink-0"
          />
        ) : (
          <HugeiconsIcon
            icon={AndroidIcon}
            size={16}
            strokeWidth={1.75}
            className="size-4 shrink-0 text-emerald-500"
          />
        )
      ) : iconUrl ? (
        <img src={iconUrl} alt="" className="size-4 shrink-0" />
      ) : (
        <span className="size-4 shrink-0" />
      )}
      {/* 工程目录分三档:当前选中(绿底已经标出来了)、开着但没选中(白)、
          没开过(灰)。绿色只留给选中态,否则满屏绿字等于没标记。 */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          asProject && !isActiveProject
            ? isOpenedProject
              ? "font-semibold text-foreground"
              : "text-muted-foreground/65"
            : !isSelected &&
                !gitignored &&
                gitStatusCode &&
                explorerGitTextClass(gitStatusCode),
        )}
      >
        {name}
      </span>
      {/* 工程挂着 worktree 就标出来,数量带圆底 */}
      {asProject && (
        <WorktreeCountBadge projectRoot={path} className="shrink-0" />
      )}
      {/* 绑过云效项目的产品目录挂个云:标记绑定关系,点一下直达项目网页。
          行本身是个 button,里面不能再套 button —— 用 span 接住点击,
          stopPropagation 免得顺带选中/展开这一行。 */}
      {yunxiaoLinked && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘用户走右键菜单的"关联云效项目"
        // biome-ignore lint/a11y/noStaticElementInteractions: 见上,button 里套不了 button
        <span
          title="打开云效项目"
          onClick={(e) => {
            e.stopPropagation();
            const link = getProjectLink(path);
            const orgId = getCodeupOrgId();
            if (link && orgId) openExternally(projexUrl(orgId, link.id));
          }}
          className="mr-0.5 flex shrink-0 items-center rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={CloudIcon}
            size={13}
            strokeWidth={1.75}
            className="size-3.5"
          />
        </span>
      )}
    </button>
  );
}

export const EntryRow = memo(EntryRowImpl);

export type PendingRowProps = {
  depth: number;
  kind: "file" | "dir";
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PendingRow({
  depth,
  kind,
  onCommit,
  onCancel,
}: PendingRowProps) {
  return (
    <div
      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      <img
        src={
          kind === "dir" ? folderIconUrl("", false) : fileIconUrl("untitled")
        }
        alt=""
        className="size-4 shrink-0 opacity-70"
      />
      <InlineInput
        initial=""
        placeholder={kind === "dir" ? "New folder" : "New file"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function StatusRow({
  depth,
  message,
  tone,
}: {
  depth: number;
  message: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "h-6 truncate px-2 text-[11px] leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      style={{ paddingLeft: 6 + depth * 12 + 18 }}
    >
      {message}
    </div>
  );
}
