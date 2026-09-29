import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { SidebarLeftIcon, SidebarRightIcon } from "@hugeicons/core-free-icons";
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
  tabBarRef: (element: HTMLDivElement | null) => void;
  workspaceToolbarRef: (element: HTMLDivElement | null) => void;
  workspaceElementRef: RefObject<HTMLDivElement | null>;
  rightPanelElementRef: RefObject<HTMLDivElement | null>;
  rightPanelExpanded: boolean;
  onToggleRightPanelExpanded: () => void;
  spaceSwitcher: ReactNode;
  androidToolbar?: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  onToggleSidebar,
  onToggleRightPanel,
  tabBarRef,
  workspaceToolbarRef,
  workspaceElementRef,
  rightPanelElementRef,
  rightPanelExpanded,
  onToggleRightPanelExpanded,
  spaceSwitcher,
  androidToolbar,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(0);
  const [workspaceBounds, setWorkspaceBounds] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const panel = rightPanelElementRef.current;
    const workspace = workspaceElementRef.current;
    const update = () => {
      const headerRect = el.getBoundingClientRect();
      const minLeft = IS_MAC ? 128 : 64;
      const rightWidth = Math.min(
        Math.max(
          USE_CUSTOM_WINDOW_CONTROLS ? 256 : 104,
          (panel?.getBoundingClientRect().width ?? 0) - (IS_MAC ? 8 : 0),
        ),
        headerRect.width - minLeft,
      );
      setCompact(headerRect.width < COMPACT_WIDTH);
      setRightPanelWidth(rightWidth);
      const workspaceRect = workspace?.getBoundingClientRect();
      if (workspaceRect) {
        const left = Math.max(minLeft, workspaceRect.left - headerRect.left);
        const right = Math.min(
          workspaceRect.right - headerRect.left,
          headerRect.width - rightWidth - (IS_MAC ? 8 : 0),
        );
        setWorkspaceBounds({ left, width: Math.max(0, right - left) });
      }
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (panel) ro.observe(panel);
    if (workspace) ro.observe(workspace);
    update();
    return () => ro.disconnect();
  }, [rightPanelElementRef, workspaceElementRef]);

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`relative flex h-10 shrink-0 items-center gap-2 select-none ${
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
      </div>

      {!IS_MAC && (
        <span className="mx-1.5 h-4 w-px shrink-0 rounded-full bg-border" />
      )}

      {IS_MAC && (
        <span className="mr-1.5 h-4 w-px shrink-0 rounded-full bg-border" />
      )}

      <div
        className="flex h-full min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {spaceSwitcher}
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      {androidToolbar}
      <div
        ref={workspaceToolbarRef}
        className="absolute top-0 h-full overflow-hidden"
        style={workspaceBounds}
      />
      {workspaceBounds.width > 0 && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 z-10 h-4 -translate-y-1/2 border-l border-foreground/[0.16]"
            style={{ left: workspaceBounds.left }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 z-10 h-4 -translate-y-1/2 border-l border-foreground/[0.16]"
            style={{ left: workspaceBounds.left + workspaceBounds.width }}
          />
        </>
      )}

      <div
        className="flex h-full min-w-0 shrink-0 items-center gap-2"
        style={{ width: rightPanelWidth }}
      >
        <div
          ref={tabBarRef}
          className="h-full min-w-0 flex-1 overflow-hidden"
        />
        <SearchInline
          ref={searchRef}
          target={searchTarget}
          compact={compact || rightPanelWidth < 600}
        />
        <Button
          onClick={onToggleRightPanelExpanded}
          title={rightPanelExpanded ? "恢复分栏" : "展开右侧面板"}
          aria-label={rightPanelExpanded ? "恢复分栏" : "展开右侧面板"}
          aria-pressed={rightPanelExpanded}
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path
              d={
                rightPanelExpanded
                  ? "M19 10h-5V5M5 14h5v5"
                  : "M14 5h5v5M10 19H5v-5"
              }
            />
          </svg>
        </Button>
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
    </div>
  );
}
