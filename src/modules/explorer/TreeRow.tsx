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
  Pin02Icon,
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
  /** 工程当前所在分支(只有开着 tab 的工程才有),灰字跟在名字后面。 */
  branch?: string | null;
  /** 编辑器里改了还没保存:git 看不见,树上用一个点标出来。 */
  dirty?: boolean;
  /** 置顶的目录:排在同级最前面,行尾挂个图钉,不然不知道为什么它在上面。 */
  pinned?: boolean;
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
    branch = null,
    dirty = false,
    pinned = false,
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
          // 图标集里不一定有 flutter,拿不到就别渲染一个 src="" 的破图,
          // 直接写个 Flutter 标签更清楚
          (namedIconUrl("flutter") ?? "") ? (
            <img
              src={namedIconUrl("flutter") ?? ""}
              alt=""
              className="size-4 shrink-0"
            />
          ) : (
            <span
              title="Flutter 工程"
              className="shrink-0 rounded bg-sky-500/15 px-1 text-[9px] font-semibold leading-4 text-sky-400"
            >
              Flutter
            </span>
          )
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
          "min-w-0 truncate",
          // 有分支要显示时名字不再撑满,分支紧跟在名字后面而不是被推到最右
          asProject && branch ? "max-w-[60%] shrink-0" : "flex-1",
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
      {/* 未保存的编辑 git 看不见,给个点(和 tab 上那个 ● 一个意思) */}
      {dirty && (
        <span
          title="有未保存的修改"
          className="size-1.5 shrink-0 rounded-full bg-amber-400"
        />
      )}
      {/* 开着 tab 的工程把当前分支亮出来:多工程并行时"哪个在哪个分支"
          是最常核对的事,不用挨个点进去看底栏 */}
      {asProject && branch && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {branch}
        </span>
      )}
      {/* 工程挂着 worktree 就标出来,数量带圆底 */}
      {asProject && (
        <WorktreeCountBadge projectRoot={path} className="shrink-0" />
      )}
      {/* 绑过云效项目的产品目录挂个云:标记绑定关系,点一下直达项目网页。
          行本身是个 button,里面不能再套 button —— 用 span 接住点击,
          stopPropagation 免得顺带选中/展开这一行。 */}
      {pinned && (
        <span
          title="已置顶"
          className="mr-0.5 shrink-0 leading-none text-muted-foreground/60"
        >
          {/* 用图标不用 📌:emoji 是彩色斜的,在一排单色描边图标里太跳 */}
          <HugeiconsIcon icon={Pin02Icon} size={11} strokeWidth={2} />
        </span>
      )}
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

/**
 * 工程下挂的 worktree 子行:同一个仓库临时切出来修 bug 的平行工作区。
 * 点击当独立工程打开 —— 它有自己的终端 tab、设备选择和投屏,和主工程
 * 互不干扰,两边可以各连一台设备同时开发。
 */
function WorktreeRowImpl({
  path,
  name,
  branch,
  depth,
  onOpen,
  isActive,
  isOpened,
  projectPtyIds,
}: {
  path: string;
  name: string;
  branch: string;
  depth: number;
  onOpen?: (path: string) => void;
  isActive: boolean;
  isOpened: boolean;
  projectPtyIds?: Record<string, number[]>;
}) {
  const agentState = useProjectAgentState(path, projectPtyIds ?? {});
  return (
    <button
      type="button"
      data-fs-path={path}
      title={`worktree · ${path}\n分支 ${branch} · 点击打开(独立终端/投屏)`}
      onClick={() => onOpen?.(path)}
      className={cn(
        "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] transition-colors hover:bg-accent/70",
        isActive
          ? "bg-emerald-500/15 font-semibold text-emerald-400"
          : "text-foreground/85",
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      <span className="size-3.5 shrink-0" />
      {agentState ? (
        <span
          title={AGENT_STATE_LABEL[agentState]}
          className={cn(
            "inline-block size-4 shrink-0 text-center text-[13px] leading-4",
            agentState === "attention" && "animate-pulse",
          )}
        >
          {AGENT_STATE_EMOJI[agentState]}
        </span>
      ) : (
        <span className="shrink-0 rounded bg-foreground/10 px-1 text-[9.5px] leading-4 text-muted-foreground">
          tree
        </span>
      )}
      <span
        className={cn(
          "min-w-0 shrink-0 truncate",
          !isActive &&
            (isOpened ? "font-semibold text-foreground" : "text-foreground/70"),
        )}
      >
        {name}
      </span>
      {/* 分支名灰字跟在后面,一眼知道这个 worktree 在干什么。
          同名也照样显示 —— "分支到底是啥"不该让人猜 */}
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground/60">
        {branch}
      </span>
    </button>
  );
}

export const WorktreeRow = memo(WorktreeRowImpl);

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
