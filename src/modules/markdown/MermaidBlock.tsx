import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// mermaid 是三百来 K 的大件,只有文档里真出现 ```mermaid 才拉;拉过一次就
// 复用同一个 promise,同一篇文档里十张图不会去下十次。
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// render() 要一个全局唯一的 id —— 它会拿这个 id 拼 SVG 内部的元素 id,重了
// 两张图的箭头标记会互相串。
let nextId = 0;

type Status =
  | { kind: "loading" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

/**
 * 把一段 mermaid 源码渲染成图。
 *
 * 语法错误不抛到外面:文档是人手写的,画不出来时把原文和错误一起摆出来,比
 * 整篇预览白掉有用。
 */
export function MermaidBlock({ chart }: { chart: string }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const idRef = useRef(`terax-mermaid-${nextId++}`);

  // 跟着应用主题走:ThemeProvider 把 light/dark 打在 <html> 上。
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "default",
          // 文档来自本仓库,但仍按不可信处理:strict 会转义图里的 HTML。
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(idRef.current, chart);
        if (!cancelled) setStatus({ kind: "ready", svg });
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [chart, dark]);

  if (status.kind === "error") {
    return (
      <div className="my-3 overflow-hidden rounded-lg border border-destructive/40">
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          图画不出来:{status.message}
        </div>
        <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "my-3 overflow-x-auto rounded-lg border border-border/60 bg-card px-3 py-3",
        // 图本身是浅色底的 SVG,居中摆着看着不飘
        "[&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full",
      )}
    >
      {status.kind === "loading" ? (
        <p className="text-[11px] text-muted-foreground">画图中…</p>
      ) : (
        // mermaid 自己按 securityLevel 消过毒,这里只负责把 SVG 放进去
        // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG from mermaid
        <div dangerouslySetInnerHTML={{ __html: status.svg }} />
      )}
    </div>
  );
}
