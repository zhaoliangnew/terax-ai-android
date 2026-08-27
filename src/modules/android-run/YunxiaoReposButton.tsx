import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { FolderGitTwoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { MENU_TRIGGER } from "./lib/menuStyles";
import { YunxiaoReposPanel } from "./YunxiaoReposPanel";

/**
 * 云效代码库:和知识库/云效项目一样从底栏往上弹,不再占用左边的文件树视图 ——
 * 它是"去找个仓库"的入口,不是天天盯着的一栏。
 */
export function YunxiaoReposButton() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          title="云效代码库"
          onClick={() => setOpen((v) => !v)}
          className={MENU_TRIGGER}
        >
          <HugeiconsIcon icon={FolderGitTwoIcon} size={13} strokeWidth={1.75} />
          云效代码库
        </button>
      </PopoverAnchor>
      <PopoverContent
        backdrop
        side="top"
        align="start"
        collisionPadding={8}
        // 新建代码库/代码组是套在里面的 Dialog,渲染在另一个 portal 里,
        // 点它会被当成"点了外面"—— 别把浮层关掉
        onInteractOutside={(e) => {
          const el = e.target as HTMLElement | null;
          if (el?.closest?.("[data-slot='dialog-content']")) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="h-[34rem] max-h-[calc(100vh-5rem)] w-[26rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <YunxiaoReposPanel />
      </PopoverContent>
    </Popover>
  );
}
