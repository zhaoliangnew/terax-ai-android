import { ViewToggle } from "@/components/ViewToggle";
import { cn } from "@/lib/utils";
import {
  ArrowReloadHorizontalIcon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { localFileUrl } from "./lib/localFileUrl";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Renders a local .html file in a sandboxed iframe over the asset protocol, so
 * relative stylesheets, scripts and images next to the page load the way they
 * would in a browser.
 *
 * 缩放走 `transform: scale` + 反向放大的 iframe 尺寸(而不是 CSS `zoom`):
 * 页面拿到的视口宽度跟着一起变,缩小时是"看到更多内容",而不是把同样的排版
 * 糊小一圈 —— 1920 宽的设计稿正需要前者。
 *
 * 只有工具栏按钮能改缩放,没有滚轮/捏合:设计稿在 `asset://` 上是另一个源的
 * 独立 document,指针压在它上面时 wheel 由它自己消化,不冒泡到这层,跨源也
 * 注入不进监听器。试过"按住修饰键就给 iframe 挂 pointer-events: none"绕,
 * 实测不稳(焦点进了设计稿之后 keydown 就收不到了),不如不留这个半吊子。
 */
export function HtmlPreviewPane({ path, visible, onSetView }: Props) {
  // Part of the iframe `key`: bumping it remounts the frame, which is how a
  // reload picks up edits made to the file since it was first rendered.
  const [nonce, setNonce] = useState(0);
  // Deferred first mount — a tab restored cold shouldn't parse and run its
  // document until the user actually looks at it.
  const [mounted, setMounted] = useState(visible);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <ViewToggle mode="rendered" onChange={onSetView} />
      {/* 右边留出 ViewToggle 的位置,免得两拨控件叠在一起 */}
      <div className="flex h-7 shrink-0 items-center gap-1 border-border/60 border-b pr-32 pl-2">
        <ToolbarButton
          label="重新加载"
          icon={ArrowReloadHorizontalIcon}
          onClick={() => setNonce((n) => n + 1)}
        />
        <div className="mx-1 h-3 w-px bg-border/60" />
        <ToolbarButton
          label="缩小"
          icon={MinusSignIcon}
          onClick={() => setScale((s) => clampScale(s / 1.1))}
        />
        <button
          type="button"
          onClick={() => setScale(1)}
          title="恢复 100%"
          className="min-w-11 rounded px-1 text-[11px] text-muted-foreground tabular-nums transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          {Math.round(scale * 100)}%
        </button>
        <ToolbarButton
          label="放大"
          icon={PlusSignIcon}
          onClick={() => setScale((s) => clampScale(s * 1.1))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        {mounted ? (
          <iframe
            key={`${path}#${nonce}`}
            src={localFileUrl(path)}
            title={path}
            className="border-0"
            style={{
              width: `${100 / scale}%`,
              height: `${100 / scale}%`,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
            }}
            // Same reasoning as the URL preview pane: grant what a local page
            // legitimately needs, but never `allow-top-navigation*`, so a
            // script in the document cannot navigate the host webview and get
            // at `window.__TAURI__`.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        ) : null}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
    </button>
  );
}
