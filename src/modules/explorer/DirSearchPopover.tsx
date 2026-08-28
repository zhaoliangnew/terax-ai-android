import { Spinner } from "@/components/ui/spinner";
import { toPinyin } from "@/lib/pinyin";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { Pin02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";

type Entry = { name: string; isDir: boolean };

const WIDTH = 320;
const MAX_HEIGHT = 380;
const MARGIN = 8;

type Props = {
  /** 要搜的目录;null = 不显示。 */
  dir: string | null;
  /** 右键时的光标位置,面板贴着它弹 —— 居中大弹框离手太远。 */
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  /** 选中一项:交给调用方决定是开工程还是在树里定位。 */
  onPick: (path: string, isDir: boolean) => void;
  /** 已置顶的路径(规范化过的),用来画图钉/切换文案。 */
  isPinned: (path: string) => boolean;
  onTogglePin: (path: string, pinned: boolean) => void;
};

/**
 * 目录内搜索:只列这个目录的**直接子项**,输入即筛,贴着右键位置弹。
 *
 * 为什么不做递归/全局搜索:上百个产品目录的仓库里,递归命中几百条之后要
 * 把命中项的父目录全展开才能在树里显示,树一撑大打字就掉帧。而实际要回答
 * 的问题("这个产品目录下有哪个工程")本来只需要看一层。
 */
export function DirSearchPopover({
  dir,
  anchor,
  onClose,
  onPick,
  isPinned,
  onTogglePin,
}: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // 用 ref 抢焦点而不是 autoFocus:那个属性在这套 lint 规则下是 error,
  // 而且面板是 portal 出来的,挂载时机自己控制更稳
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!dir) return;
    // 它是从右键菜单里开的,而 Radix 的菜单关闭时会把焦点还给触发元素 ——
    // 那一下发生在我们抢焦点之后,输入框就白聚焦了。所以补几次,抢赢为止。
    const timers = [0, 60, 160].map((delay) =>
      window.setTimeout(() => {
        const el = inputRef.current;
        if (el && document.activeElement !== el) el.focus();
      }, delay),
    );
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [dir]);

  useEffect(() => {
    if (!dir) return;
    setEntries(null);
    setQuery("");
    setActive(0);
    let alive = true;
    native
      .readDir(dir)
      .then((list) => {
        if (!alive) return;
        setEntries(
          list
            .map((e) => ({ name: e.name, isDir: e.kind === "dir" }))
            // 目录在前,再按名字排 —— 找工程比找文件常见
            .sort((a, b) =>
              a.isDir !== b.isDir
                ? a.isDir
                  ? -1
                  : 1
                : a.name.localeCompare(b.name, "zh"),
            ),
        );
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [dir]);

  useEffect(() => {
    if (!dir) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dir, onClose]);

  // 每个条目的拼音只算一次;上百个目录逐字转拼音,跟着每次按键重算会掉帧
  const indexed = useMemo(
    () =>
      (entries ?? []).map((e) => ({
        entry: e,
        pinyin: toPinyin(e.name, "").toLowerCase(),
      })),
    [entries],
  );

  /**
   * 中文和拼音互相都能搜到:查询词和条目名各自转一遍拼音再比。
   *
   * 目录名这儿是混着的 —— 「0.2.0-标准版本」是中文,底下的工程又都是
   * `app_xxx` 拼音。想到哪个打哪个,不该还要先想"这个目录当初起的是中文名
   * 还是拼音名"。非中文字符原样保留,所以纯英文查询走的还是普通子串匹配。
   */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!entries) return [];
    if (!q) return entries;
    const qPinyin = toPinyin(q, "").toLowerCase();
    return indexed
      .filter(
        ({ entry, pinyin }) =>
          entry.name.toLowerCase().includes(q) || pinyin.includes(qPinyin),
      )
      .map(({ entry }) => entry);
  }, [entries, indexed, query]);

  // 筛完之后高亮项可能已经越界
  useEffect(() => {
    setActive((i) => (i >= hits.length ? 0 : i));
  }, [hits.length]);

  if (!dir || !anchor) return null;

  const pathOf = (name: string) => `${dir.replace(/\/+$/, "")}/${name}`;
  const pick = (e: Entry) => {
    onPick(pathOf(e.name), e.isDir);
    onClose();
  };

  // 贴着光标,但不能被窗口边缘切掉
  const left = Math.max(
    MARGIN,
    Math.min(anchor.x, window.innerWidth - WIDTH - MARGIN),
  );
  const top = Math.max(
    MARGIN,
    Math.min(anchor.y, window.innerHeight - MAX_HEIGHT - MARGIN),
  );

  return createPortal(
    <>
      {/* 点外部关掉的挡板 —— 做成 button 才不用一堆 a11y 抑制注释,
          键盘用户按 Esc 就行 */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="关闭目录内搜索"
        className="fixed inset-0 z-50 cursor-default"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
        style={{ left, top, width: WIDTH, maxHeight: MAX_HEIGHT }}
      >
        <div className="shrink-0 border-b border-border px-2.5 py-2">
          <div
            className="mb-1.5 truncate text-[10.5px] text-muted-foreground/80"
            title={dir}
          >
            {dir.split("/").pop()} · 只看这一层
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = hits[active];
                if (hit) pick(hit);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="输入名字筛选…"
            className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {entries == null ? (
            <div className="flex items-center gap-2 px-2 py-2 text-[11.5px] text-muted-foreground">
              <Spinner className="size-3" />
              正在读取…
            </div>
          ) : hits.length === 0 ? (
            <div className="px-2 py-2 text-[11.5px] text-muted-foreground">
              {entries.length === 0 ? "这个目录是空的" : "没有匹配的条目"}
            </div>
          ) : (
            hits.map((e, i) => {
              const icon = e.isDir
                ? folderIconUrl(e.name, false)
                : fileIconUrl(e.name);
              const path = pathOf(e.name);
              const pinned = e.isDir && isPinned(path);
              return (
                <div
                  key={e.name}
                  className={cn(
                    "group flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1.5 hover:bg-foreground/10",
                    i === active && "bg-foreground/10",
                  )}
                >
                  <button
                    type="button"
                    title={path}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(e)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                  >
                    {icon ? (
                      <img src={icon} alt="" className="size-3.5 shrink-0" />
                    ) : (
                      <span className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {e.name}
                    </span>
                  </button>
                  {/* 置顶就在结果里点,不用关掉框再去树里找那一行 */}
                  {e.isDir && (
                    <button
                      type="button"
                      title={pinned ? "取消置顶" : "置顶"}
                      onClick={() => onTogglePin(path, !pinned)}
                      className={cn(
                        "shrink-0 cursor-pointer px-0.5 leading-none text-muted-foreground transition-opacity",
                        pinned
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
                      )}
                    >
                      <HugeiconsIcon
                        icon={Pin02Icon}
                        size={11}
                        strokeWidth={2}
                      />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        {entries != null && (
          <div className="shrink-0 border-t border-border px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
            {query.trim()
              ? `${hits.length} / ${entries.length} 项`
              : `共 ${entries.length} 项`}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
