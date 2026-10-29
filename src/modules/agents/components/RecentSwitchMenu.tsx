import { cn } from "@/lib/utils";
import {
  focusChatInputSoon,
  useRecentSwitchStore,
} from "@/modules/explorer/lib/recentSwitch";
import {
  AndroidIcon,
  Clock01Icon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/**
 * 输入框底栏的"最近":鼠标放上去就弹出左栏"最近"那份列表(开着终端的,
 * 按最近切换排),点一下切过去。打完字不用再把鼠标挪到左上角。
 */
export function RecentSwitchMenu({ labelClass }: { labelClass: string }) {
  const groups = useRecentSwitchStore((s) => s.groups);
  const active = useRecentSwitchStore((s) => s.active);
  const open = useRecentSwitchStore((s) => s.open);
  const [shown, setShown] = useState(false);
  // 移出去稍等一下再收:从按钮挪到菜单的路上不至于闪没
  const hideTimer = useRef<number | null>(null);
  const cancelHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  useEffect(() => cancelHide, []);
  if (groups.length === 0) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬停展开,里面的项都是 button
    <div
      className="relative"
      onMouseEnter={() => {
        cancelHide();
        setShown(true);
      }}
      onMouseLeave={() => {
        cancelHide();
        hideTimer.current = window.setTimeout(() => setShown(false), 150);
      }}
    >
      <span className="flex h-7 shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
        <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.75} />
        <span className={labelClass}>最近</span>
      </span>
      {shown && (
        // 外层 pb 垫出一截透明区,鼠标从按钮往上挪进菜单时不会断开
        <div className="absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5">
          {/* 和左栏一样三层:目录标题 → 产品卡片 → worktree 卡片(缩进挂在产品下);
              卡片两行字、行高宽松,点着不费劲 */}
          <div className="flex max-h-[65vh] w-[26rem] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-lg">
            {groups.map((g) => (
              <div key={g.folder} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[12px] font-semibold text-foreground/85">
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-foreground/60"
                  />
                  <span className="truncate">{baseName(g.folder)}</span>
                </div>
                {g.rows.map((r) => {
                  const isActive = r.path === active;
                  return (
                    <button
                      key={r.path}
                      type="button"
                      title={r.path}
                      onClick={() => {
                        open(r.path);
                        setShown(false);
                        // 切过去接着打字,不用再点一下输入框
                        focusChatInputSoon();
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        r.depth === 2 ? "ml-9" : "ml-3",
                        isActive
                          ? "border-emerald-500/50 bg-emerald-500/10"
                          : "border-transparent bg-foreground/[0.04] hover:border-border hover:bg-foreground/10",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md",
                          isActive
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-foreground/[0.06] text-emerald-500/80",
                        )}
                      >
                        <HugeiconsIcon
                          icon={r.isWorktree ? GitBranchIcon : AndroidIcon}
                          size={15}
                          strokeWidth={1.75}
                        />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={cn(
                            "truncate text-[13.5px]",
                            isActive
                              ? "font-semibold text-emerald-400"
                              : "text-foreground",
                          )}
                        >
                          {r.isWorktree ? r.branch || r.name : r.name}
                        </span>
                        <span className="truncate text-[11.5px] text-muted-foreground">
                          {r.isWorktree ? "worktree" : (r.branch ?? "")}
                        </span>
                      </span>
                      {isActive && (
                        <span className="shrink-0 text-[11px] text-emerald-400/80">
                          当前
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
