import { cn } from "@/lib/utils";
import type { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  icon: typeof Delete02Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

/** 悬停时才露出来的小图标(上移/下移/编辑/删除),自定义入口和群列表共用。 */
export function MenuRowIcon({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        // 别让点击顺带触发所在行的"打开"。
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-4 items-center justify-center rounded text-muted-foreground/70 disabled:opacity-25",
        destructive ? "hover:text-red-400" : "hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
    </button>
  );
}
