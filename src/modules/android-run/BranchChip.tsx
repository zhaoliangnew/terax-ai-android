import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

/**
 * 当前工程在哪个分支。
 *
 * 隔一会儿重问一次,外加窗口回到前台时立刻问 —— 分支是在终端里 `git checkout`
 * 改的,应用这边收不到通知;而"以为在 A 分支其实在 B"是这个工具最容易惹出的
 * 事故(编译安装到设备上才发现装错版本)。一次 git 调用很便宜。
 */
export function useProjectBranch(root: string | null): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!root) {
      setBranch(null);
      return;
    }
    let alive = true;
    const read = () => {
      native
        .gitResolveRepo(root)
        .then((repo) => {
          if (alive) setBranch(repo?.branch || null);
        })
        .catch(() => {
          if (alive) setBranch(null);
        });
    };
    read();
    const timer = setInterval(read, 15_000);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [root]);

  return branch;
}

type Props = {
  projectRoot: string | null;
  className?: string;
  /** 只要文字,不要图标(水印那种大字底下用)。 */
  bare?: boolean;
};

/** 分支名。没有 git 仓库就什么都不画,不占位置。 */
export function BranchChip({ projectRoot, className, bare }: Props) {
  const branch = useProjectBranch(projectRoot);
  if (!branch) return null;
  return (
    <span
      title={`当前分支 · ${branch}`}
      className={cn(
        "flex min-w-0 shrink items-center gap-1 text-muted-foreground",
        className,
      )}
    >
      {!bare && (
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0"
        />
      )}
      <span className="truncate">{branch}</span>
    </span>
  );
}
