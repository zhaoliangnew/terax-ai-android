import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { SearchAddon } from "@xterm/addon-search";
import { Fragment, type ReactNode } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  /** 窗格底部的附加内容(比如 AI 命令行输入框),按 leaf 各画各的。 */
  renderLeafFooter?: (leafId: number) => ReactNode;
  /** 盖在终端上面的内容(比如 agent 的聊天视图),终端本身照常挂着。 */
  renderLeafOverlay?: (
    leafId: number,
    ctx: { visible: boolean; focused: boolean },
  ) => ReactNode;
  /** 这些窗格上面盖着别的界面(聊天视图):终端不抢键盘焦点。 */
  focusSuppressed?: ReadonlySet<number>;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const {
      tabVisible,
      activeLeafId,
      blocks,
      onFocusLeaf,
      getBundle,
      renderLeafFooter,
      renderLeafOverlay,
      focusSuppressed,
    } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <div
        // Portaled popups (menus opened from this pane) still bubble React
        // events up here; they aren't clicks on the pane, so ignore them.
        onMouseDownCapture={(e) => {
          if (!e.currentTarget.contains(e.target as Node)) return;
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.target as Node)) return;
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="flex h-full w-full flex-col"
      >
        {/* overflow-hidden:底部挂了输入框、这块变矮的那一下,终端画布还是旧
            高度,不裁的话最下面几行会画到输入框上 */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <TerminalPane
            leafId={node.id}
            visible={tabVisible}
            focused={focused && !focusSuppressed?.has(node.id)}
            initialCwd={node.cwd}
            blocks={blocks}
            ref={b.setRef}
            onSearchReady={b.onSearchReady}
            onCwd={b.onCwd}
            onExit={b.onExit}
          />
          {renderLeafOverlay?.(node.id, { visible: tabVisible, focused })}
          <DropOverlay leafId={node.id} />
        </div>
        {renderLeafFooter?.(node.id)}
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => {
        const slotId = firstLeafSlotId(child);
        return (
          <Fragment key={slotId}>
            {i > 0 && (
              <ResizableHandle className="bg-border/50 transition-colors duration-[var(--dur-fast)] after:w-5 hover:bg-border" />
            )}
            <ResizablePanel id={`pane-slot-${slotId}`} minSize="10%">
              <PaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
