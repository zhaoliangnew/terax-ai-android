import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { Tab } from "@/modules/tabs";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  /** 当前 Space 里的非终端 tab(文件、预览、diff)。 */
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};

/**
 * 打开的文件一条小 tab 栏。顶部 tab 栏撤了之后,终端靠左侧项目树切换和
 * 关闭,但文件、预览、diff 在树上没有对应的行,开了就只剩 ⌘W 能关。这条
 * 只列这类 tab,一个都没有就不出现。
 */
export function FileTabStrip({ tabs, activeId, onSelect, onClose }: Props) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border [scrollbar-width:none]">
      {tabs.map((t) => {
        const active = t.id === activeId;
        const path = "path" in t && typeof t.path === "string" ? t.path : null;
        const dirty = t.kind === "editor" && t.dirty;
        return (
          <div
            key={t.id}
            title={path ?? t.title}
            className={cn(
              "group flex max-w-56 shrink-0 items-center gap-1.5 border-r border-border/60 pr-1 pl-2.5 text-[12px] transition-colors",
              active
                ? "bg-foreground/[0.06] text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              // 中键关,和浏览器一样
              onAuxClick={(e) => {
                if (e.button === 1) onClose(t.id);
              }}
              className="flex min-w-0 cursor-pointer items-center gap-1.5"
            >
              {path && (
                <img
                  src={fileIconUrl(path.split("/").pop() ?? path)}
                  alt=""
                  className="size-3.5 shrink-0"
                />
              )}
              <span className="truncate">{t.title}</span>
            </button>
            <button
              type="button"
              aria-label={`关闭 ${t.title}`}
              title={dirty ? "有未保存的修改,关闭(⌘W)" : "关闭(⌘W)"}
              onClick={() => onClose(t.id)}
              className="group/close flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-foreground/10"
            >
              {/* 有未保存的修改:平时是个点,鼠标移上去才变成 × */}
              {dirty && (
                <span className="size-1.5 rounded-full bg-amber-400 group-hover/close:hidden" />
              )}
              <HugeiconsIcon
                icon={Cancel01Icon}
                size={11}
                strokeWidth={2}
                className={cn(
                  dirty && "hidden group-hover/close:block",
                  !dirty && !active && "opacity-0 group-hover:opacity-100",
                )}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
