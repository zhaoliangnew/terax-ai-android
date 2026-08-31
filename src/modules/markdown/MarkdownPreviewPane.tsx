import {
  MarkdownCode,
  markdownCodeText,
} from "@/components/ai-elements/markdown-code";
import { ViewToggle } from "@/components/ViewToggle";
import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { SidebarRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownToc, useToc } from "./MarkdownToc";
import { MermaidBlock } from "./MermaidBlock";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

/**
 * ```mermaid 画成图,其它围栏还是走高亮代码块。只在文档预览里这么干 ——
 * AI 对话那边的代码块保持原样。
 */
function PreviewCode({
  className,
  children,
  ...rest
}: {
  className?: string;
  children?: ReactNode;
}) {
  if (/\blanguage-mermaid\b/.test(className ?? "")) {
    return (
      <MermaidBlock chart={markdownCodeText(children).replace(/\n$/, "")} />
    );
  }
  return (
    <MarkdownCode className={className} {...rest}>
      {children}
    </MarkdownCode>
  );
}

const components = { a: MarkdownLink, code: PreviewCode };

export function MarkdownPreviewPane({ path, visible, onSetView }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [tocOpen, setTocOpen] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { entries, activeIndex, scan, scrollTo, onScroll } =
    useToc(scrollerRef);

  // 正文渲染完再扫标题。等一帧是因为 streamdown 分块渲染,同一个 tick 里
  // DOM 还没铺满,先扫会只拿到前几个标题。
  useEffect(() => {
    if (status.kind !== "ready") return;
    const raf = requestAnimationFrame(scan);
    return () => cancelAnimationFrame(raf);
  }, [status, scan]);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <ViewToggle mode="rendered" onChange={onSetView} />
      <div className="flex min-h-0 flex-1">
        {entries.length > 1 &&
          (tocOpen ? (
            <MarkdownToc
              entries={entries}
              activeIndex={activeIndex}
              onSelect={scrollTo}
              onCollapse={() => setTocOpen(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              title="展开目录"
              aria-label="展开目录"
              className="flex w-7 shrink-0 items-start justify-center border-border/60 border-r pt-2 text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground"
            >
              <HugeiconsIcon
                icon={SidebarRight01Icon}
                size={12}
                strokeWidth={1.75}
              />
            </button>
          ))}
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto"
        >
          <div className="px-8 py-6">
            {status.kind === "loading" && (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            )}
            {status.kind === "error" && (
              <p className="text-[12px] text-destructive">
                Failed to read file: {status.message}
              </p>
            )}
            {status.kind === "binary" && (
              <p className="text-[12px] text-muted-foreground">
                Binary file — cannot render as markdown.
              </p>
            )}
            {status.kind === "toolarge" && (
              <p className="text-[12px] text-muted-foreground">
                File is {status.size} bytes; limit {status.limit}.
              </p>
            )}
            {status.kind === "ready" && (
              <Streamdown
                className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                components={components}
                mode="static"
                parseIncompleteMarkdown={false}
              >
                {status.content}
              </Streamdown>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
