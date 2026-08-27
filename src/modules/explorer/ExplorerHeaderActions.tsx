import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";

export type ExplorerHeaderAction = {
  id: string;
  icon: IconSvgElement;
  /** 既当 tooltip,也当收进 ⋯ 之后的菜单文案,所以要能脱离图标独立读懂。 */
  label: string;
  /** 单独给 tooltip 用的长文案(比如"上一级"要带上目标路径),菜单里还是用 label。 */
  tooltip?: string;
  onClick: () => void;
  /** 亮着的状态,比如筛选开启。 */
  active?: boolean;
  iconSize?: number;
  /** 用文字代替图标(比如 "diff")—— 有些动作画成图标反而认不出。 */
  text?: string;
};

/** size-6 的按钮 + gap-1。 */
const SLOT = 28;
/** 留给标题的最小地盘:文件夹图标 15 + 左右留白 12 + 一两个字。 */
const TITLE_MIN = 46;

type Props = {
  actions: ExplorerHeaderAction[];
  /** 头部的内容宽度(ResizeObserver 的 contentRect,已经不含 padding);
   * null = 还没量到,先全画出来。 */
  width: number | null;
};

/**
 * 塞不下就收进 ⋯,而不是溢出去。
 *
 * 侧栏一分为二之后,左栏在小屏默认宽度下只有两百来像素,七个按钮一行放不下。
 * 原来是直接溢出到右栏上面 —— 图标看得见,但点击落在右栏的头部上,成了摆设。
 * 现在按实际宽度算能放几个,放不下的从右往左收进溢出菜单;数组顺序就是优先级,
 * 越靠后越先被收走。
 */
export function ExplorerHeaderActions({ actions, width }: Props) {
  const room =
    width === null
      ? actions.length
      : Math.max(0, Math.floor((width - TITLE_MIN) / SLOT));

  // 放不下时 ⋯ 自己也要占一格,所以能露在外面的就少一个。
  const inlineCount =
    room >= actions.length ? actions.length : Math.max(0, room - 1);
  const inline = actions.slice(0, inlineCount);
  const overflow = actions.slice(inlineCount);

  return (
    <>
      {inline.map((a) => (
        <Button
          key={a.id}
          variant="ghost"
          size="icon"
          className={cn(
            a.text ? "h-6 w-auto px-1.5 text-[11px]" : "size-6",
            a.active
              ? "text-emerald-500 hover:text-emerald-400"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={a.onClick}
          title={a.tooltip ?? a.label}
          aria-label={a.label}
        >
          {a.text ?? (
            <HugeiconsIcon
              icon={a.icon}
              size={a.iconSize ?? 13}
              strokeWidth={2}
            />
          )}
        </Button>
      ))}

      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-6",
                // 收进去的里面有亮着的,外面这颗也跟着亮,不然状态就藏没了。
                overflow.some((a) => a.active)
                  ? "text-emerald-500 hover:text-emerald-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="更多"
              aria-label="更多"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={14}
                strokeWidth={2}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={COMPACT_CONTENT}>
            {overflow.map((a) => (
              <DropdownMenuItem
                key={a.id}
                className={cn(COMPACT_ITEM, a.active && "text-emerald-500")}
                onSelect={() => a.onClick()}
              >
                <HugeiconsIcon
                  icon={a.icon}
                  size={a.iconSize ?? 13}
                  strokeWidth={2}
                />
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
