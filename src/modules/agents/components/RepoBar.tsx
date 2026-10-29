import { cn } from "@/lib/utils";
import { ProductLabel } from "@/modules/explorer/ProductLabel";
import {
  AndroidIcon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";

/** 输入框上方显示的目录、工程名和当前分支;在 worktree 里再带上 worktree 名。 */
export type RepoBranch = {
  name: string;
  /** 工程所在的上一级目录名(同名工程多,靠它分是哪家的)。 */
  folder: string;
  /** 工程文件夹名(worktree 里是主工程的)。 */
  project: string;
  worktree: string | null;
  changed: number;
};

/**
 * "目录 › 工程 › 分支"那一条卡片(加未提交文件数)。聊天输入框上方用;
 * 会话没连上、输入框不出来时单独摆着,照样看得出是哪个工程。
 */
export function RepoBar({
  branch,
  onOpenRepo,
  children,
  left,
}: {
  branch: RepoBranch;
  /** 点分支:切到右栏仓库 tab;点未提交文件数时 commit=true,直接弹提交框。 */
  onOpenRepo?: (commit?: boolean) => void;
  /** 跟在卡片后面的东西(输入框那边放"继续""通知测试"这类一点就发的话)。 */
  children?: ReactNode;
  /** 卡片左边紧挨着的东西(上一个/下一个项目:点完旁边就是新项目,视线不用挪)。 */
  left?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-none items-center gap-2 px-2 pb-1.5 text-[12px] text-muted-foreground">
      {/* 和左栏一样的层级:目录 › 产品 › 分支。字放大、产品白字加粗,分支
          做成小胶囊:worktree 绿底带分支图标(和左栏开着的 worktree 一个颜色),
          主工程的分支灰底,一眼分得开。worktree 只写分支名,目录名悬停看 */}
      {left}
      <button
        type="button"
        title={`打开仓库${branch.worktree ? `\nworktree 目录:${branch.worktree}` : ""}`}
        onClick={() => onOpenRepo?.()}
        // 整条做成一张卡片:浅底、细边、圆角,和聊天正文分开
        className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 bg-foreground/[0.04] px-2.5 text-[12.5px] transition-colors hover:border-border hover:bg-foreground/[0.08]"
      >
        {branch.folder && (
          <>
            <HugeiconsIcon
              icon={Folder01Icon}
              size={13}
              strokeWidth={1.75}
              className="shrink-0 text-foreground/60"
            />
            <span className="min-w-0 truncate text-foreground/70">
              {branch.folder}
            </span>
            <span className="shrink-0 text-muted-foreground/60">›</span>
          </>
        )}
        {branch.project && (
          <span className="flex shrink-0 items-center gap-1 font-semibold text-foreground">
            <HugeiconsIcon
              icon={AndroidIcon}
              size={13}
              strokeWidth={1.75}
              className="shrink-0 text-emerald-500"
            />
            <ProductLabel name={branch.project} />
          </span>
        )}
        <span className="shrink-0 text-muted-foreground/60">›</span>
        <span
          title={branch.name}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-px",
            branch.worktree
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-foreground/10 text-foreground/80",
          )}
        >
          {branch.worktree && (
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={12}
              strokeWidth={2}
              className="shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{branch.name}</span>
        </span>
      </button>
      {/* 工作区干净就不占位置,一眼看出有没有要提交的;紧跟在项目卡片后面 */}
      {branch.changed > 0 && (
        <button
          type="button"
          title="提交这些改动"
          onClick={() => onOpenRepo?.(true)}
          className="shrink-0 text-[11px] tabular-nums text-amber-500/80 hover:underline"
        >
          {branch.changed} 个文件未提交
        </button>
      )}
      {/* 常用的话(继续、通知测试)靠右,和下面输入框右边对齐。输入框圆角
          24px,按钮贴着角会像夹在里面:往左让到圆角以内 */}
      <span className="mr-4 ml-auto flex shrink-0 items-center gap-2">
        {children}
      </span>
    </div>
  );
}

/**
 * 会话没连上时摆在聊天区中间的大卡片:工程名放大,下面一行目录和分支,
 * 一眼就知道这是哪个工程(底下的输入框这时不出来)。
 */
export function RepoHero({ branch }: { branch: RepoBranch }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-400">
        <HugeiconsIcon icon={AndroidIcon} size={26} strokeWidth={1.75} />
      </span>
      <span className="text-[22px] font-semibold text-foreground">
        <ProductLabel name={branch.project} />
      </span>
      <span className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
        {branch.folder && (
          <span className="flex items-center gap-1">
            <HugeiconsIcon icon={Folder01Icon} size={14} strokeWidth={1.75} />
            {branch.folder}
          </span>
        )}
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5",
            branch.worktree
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-foreground/10 text-foreground/80",
          )}
        >
          {branch.worktree && (
            <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={2} />
          )}
          {branch.name}
        </span>
      </span>
    </div>
  );
}
