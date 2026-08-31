import { cn } from "@/lib/utils";
import { SidebarLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type TocEntry = {
  /** 1–6,用来缩进 */
  depth: number;
  text: string;
};

/**
 * 目录直接从渲染后的 DOM 里读,而不是再解析一遍 markdown 源码。
 *
 * 好处是天然对齐:围栏里的 `# 注释`、streamdown 自己的规范化、以后换解析器,
 * 都不会让目录和正文错位 —— 列表里的第 n 条永远就是正文里的第 n 个标题。
 */
export function useToc(scrollerRef: React.RefObject<HTMLElement | null>) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const headingsRef = useRef<HTMLElement[]>([]);

  const scan = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("h1, h2, h3, h4"),
    );
    headingsRef.current = nodes;
    setEntries(
      nodes.map((el) => ({
        depth: Number(el.tagName.slice(1)),
        text: el.textContent?.trim() ?? "",
      })),
    );
  }, [scrollerRef]);

  const scrollTo = useCallback((index: number) => {
    const el = headingsRef.current[index];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveIndex(index);
  }, []);

  /** 跟着滚动位置高亮:最后一个越过视口顶端的标题就是"当前所在"。 */
  const onScroll = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 8;
    let next = 0;
    headingsRef.current.forEach((el, i) => {
      if (el.getBoundingClientRect().top <= top) next = i;
    });
    setActiveIndex(next);
  }, [scrollerRef]);

  return { entries, activeIndex, scan, scrollTo, onScroll };
}

type Props = {
  entries: TocEntry[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onCollapse: () => void;
};

export function MarkdownToc({
  entries,
  activeIndex,
  onSelect,
  onCollapse,
}: Props) {
  // 目录本身也会滚:当前项被滚出去之后点起来很别扭,跟着带一下。
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (activeIndex < 0) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <nav className="flex w-56 shrink-0 flex-col border-border/60 border-r bg-background/60">
      <div className="flex h-7 shrink-0 items-center justify-between border-border/60 border-b pr-1 pl-3">
        <span className="text-[10.5px] text-muted-foreground uppercase tracking-wide">
          目录
        </span>
        <button
          type="button"
          onClick={onCollapse}
          title="收起目录"
          aria-label="收起目录"
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <HugeiconsIcon
            icon={SidebarLeft01Icon}
            size={12}
            strokeWidth={1.75}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {entries.map((entry, i) => (
          <button
            // 位置就是身份:目录是按文档顺序从 DOM 扫出来的,第 i 条永远对着
            // 正文第 i 个标题;标题文字反而会重复(几节都叫"异常")。
            // biome-ignore lint/suspicious/noArrayIndexKey: index is the identity here
            key={`${i}-${entry.text}`}
            ref={i === activeIndex ? activeRef : undefined}
            type="button"
            onClick={() => onSelect(i)}
            title={entry.text}
            className={cn(
              "block w-full truncate py-1 pr-2 text-left text-[11.5px] leading-tight transition-colors",
              i === activeIndex
                ? "bg-accent/60 text-foreground"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
            )}
            style={{ paddingLeft: `${0.75 + (entry.depth - 1) * 0.65}rem` }}
          >
            {entry.text}
          </button>
        ))}
      </div>
    </nav>
  );
}
