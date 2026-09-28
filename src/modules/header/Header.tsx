import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import {
  Settings01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  onToggleSidebar: () => void;
  /** 右栏(投屏/源码/仓库)开合,按钮放在标题栏最右边,照 Codex。 */
  onToggleRightPanel: () => void;
  /** 命令面板入口。标题栏那颗按钮先隐藏了,这里留着,重新显示时不用再接线。 */
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  spaceSwitcher: ReactNode;
  androidToolbar?: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  onToggleSidebar,
  onToggleRightPanel,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  spaceSwitcher,
  androidToolbar,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

        {/* 命令面板的按钮先收起来 —— 快捷键(⌘K)还在,只是不占标题栏的位置。 */}

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      {!IS_MAC && (
        <span className="mx-1.5 h-4 w-px shrink-0 rounded-full bg-border" />
      )}

      {IS_MAC && (
        <span className="mr-1.5 h-4 w-px shrink-0 rounded-full bg-border" />
      )}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {/* 顶部 tab 栏撤了:工程在左边树里点一下就切过去(和 worktree 行
            一样),这里只留拖动区。 */}
        {spaceSwitcher}
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      {androidToolbar}

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      {IS_MAC && (
        <>
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
          {settingsButton}
        </>
      )}

      {!IS_MAC && settingsButton}

      <Button
        onClick={onToggleRightPanel}
        title="显示/隐藏右栏"
        aria-label="显示/隐藏右栏"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={SidebarRightIcon} size={18} strokeWidth={1.75} />
      </Button>

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
