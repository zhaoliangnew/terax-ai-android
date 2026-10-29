import { cn } from "@/lib/utils";
import { useProjectAgentState } from "@/modules/agent-status/AgentStatusDot";
import { native } from "@/modules/ai/lib/native";
import { Dim } from "@/modules/explorer/Dim";
import {
  productAlias,
  useProductAliases,
} from "@/modules/explorer/lib/productAliases";
import { recentProjectInfo } from "@/modules/explorer/lib/recentProjects";
import {
  focusChatInputSoon,
  type RecentSwitchGroup,
  useProjectPanes,
  useRecentSwitchStore,
} from "@/modules/explorer/lib/recentSwitch";
import { ProductLabel } from "@/modules/explorer/ProductLabel";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { clearChatFinished, useLeavesChatState } from "../store/chatProviders";
import type { RepoBranch } from "./RepoBar";

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 在"最近"的分组里找这一行(分支、上次用的时间)。 */
function recentRow(groups: RecentSwitchGroup[], path: string) {
  for (const g of groups) for (const r of g.rows) if (r.path === path) return r;
  return null;
}

/** 上次切过去是多久以前(和"最近"菜单同一套说法)。 */
function usedAgo(at: number | null | undefined): string {
  if (!at) return "";
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const d = new Date(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return `${Math.floor(min / 60)} 小时前`;
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

type RowData = {
  folder: string;
  product: string;
  branch: string | null;
  worktree: boolean;
};

function rowOf(path: string, groups: RecentSwitchGroup[]): RowData {
  const info = recentProjectInfo(path);
  const root = info.mainRoot ?? path;
  return {
    folder: baseName(root.slice(0, root.lastIndexOf("/"))),
    product: baseName(root),
    branch:
      recentRow(groups, path)?.branch ?? (info.isWorktree ? info.name : null),
    worktree: info.isWorktree,
  };
}

/** 一行四格(标签 | 目录 | 产品 | 分支),三行共用一套列,上下对齐。 */
function Cells({
  label,
  row,
  current,
}: {
  label: ReactNode;
  row: RowData;
  current: boolean;
}) {
  return (
    <>
      <span className="flex items-center gap-1 whitespace-nowrap text-[11.5px]">
        {label}
      </span>
      <span
        // 目录名右对齐,紧贴着后面的产品名,长短不一也齐
        className={cn(
          "truncate text-right",
          current
            ? "text-foreground/70"
            : // 鼠标停在这行:整行一起变绿,和"当前"同一个颜色(点了它就成当前);
              // 各格自己写了颜色,得单独跟着变
              "text-muted-foreground/70 group-hover:text-emerald-400",
        )}
      >
        {row.folder}
      </span>
      <span
        className={cn(
          "whitespace-nowrap",
          current
            ? "font-semibold text-foreground"
            : // 其他行和同行别的字一样灰,只有当前那行亮
              "text-muted-foreground/70 group-hover:text-emerald-400",
        )}
      >
        <ProductLabel name={row.product} />
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1",
          current
            ? "text-foreground/80"
            : "text-muted-foreground/70 group-hover:text-emerald-400",
        )}
      >
        {/* 主目录也带个标签,和 tree 的标签上下对齐;不是 git 仓库(没分支)就不写 */}
        {(row.branch || row.worktree) && (
          <span
            className={cn(
              "w-[38px] shrink-0 rounded bg-foreground/10 text-center text-[10px] leading-4 text-muted-foreground",
              !current &&
                "group-hover:bg-emerald-500/20 group-hover:text-emerald-400",
            )}
          >
            {row.worktree ? "tree" : "主目录"}
          </span>
        )}
        <span className="truncate">{row.branch ?? ""}</span>
      </span>
    </>
  );
}

/** 量文字宽度(和界面一样的字体):两块共用的列宽按实际最长的名字定。 */
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
const FONT = `-apple-system, "PingFang SC", sans-serif`;

/**
 * 上下两块(输入框上面的当前项目、下面的最近项目)用同一套列宽:目录、产品
 * 两列按这几行里最长的名字量出来 —— 写死宽度的话名字一短就空出一大截,
 * 不写死又上下对不齐。
 */
function useColumns(current: RepoBranch): React.CSSProperties {
  const order = useRecentSwitchStore((s) => s.order);
  const active = useRecentSwitchStore((s) => s.active);
  const count = useRecentPrefs((s) => s.count);
  const overrides = useProductAliases((s) => s.overrides);
  const rows = [
    { folder: current.folder, product: current.project },
    ...order
      .filter((p) => p !== active)
      .slice(0, count)
      .map((p) => {
        const r = rowOf(p, []);
        return { folder: r.folder, product: r.product };
      }),
  ];
  let folder = 0;
  let product = 0;
  for (const r of rows) {
    folder = Math.max(folder, textWidth(r.folder, `12.5px ${FONT}`));
    const alias = productAlias(overrides, r.product);
    const w = alias
      ? textWidth(alias, `600 12.5px ${FONT}`) +
        6 +
        textWidth(r.product, `11px ${FONT}`)
      : textWidth(r.product, `600 12.5px ${FONT}`);
    product = Math.max(product, w);
  }
  return {
    gridTemplateColumns: `68px ${Math.min(240, Math.ceil(folder) + 4)}px ${Math.min(
      360,
      Math.ceil(product) + 6,
    )}px minmax(0,1fr) auto`,
  };
}

const GRID = "grid gap-x-4";

/** 输入框正上方:当前项目一行(位置固定,一眼看到),右边未提交数和常用的话。 */
export function CurrentProjectRow({
  current,
  onOpenRepo,
  extra,
}: {
  current: RepoBranch;
  onOpenRepo?: (commit?: boolean) => void;
  /** 最右边的按钮(继续、通知测试)。 */
  extra?: ReactNode;
}) {
  const mode = useRecentPrefs((s) => s.mode);
  const cols = useColumns(current);
  const active = useRecentSwitchStore((s) => s.active);
  const tail = (
    <span className="flex items-center justify-end gap-2">
      {/* 当前项目也显示 AI 状态:这一轮做完了马上看得到 */}
      <StateLabel path={active} />
      {current.changed > 0 && (
        <button
          type="button"
          title="提交这些改动"
          onClick={() => onOpenRepo?.(true)}
          className="shrink-0 text-[11px] tabular-nums text-amber-500/80 hover:underline"
        >
          {current.changed} 个文件未提交
        </button>
      )}
      {extra}
    </span>
  );
  const repoTitle = `打开仓库${current.worktree ? `\nworktree 目录:${current.worktree}` : ""}`;
  // 最近收进了按钮:下面没有要对齐的列表,当前项目就紧凑地写成一行
  if (mode === "popup")
    return (
      <div className="flex h-8 items-center gap-2 px-4 pb-1 text-[12.5px]">
        <button
          type="button"
          title={repoTitle}
          onClick={() => onOpenRepo?.()}
          className="flex min-w-0 cursor-pointer items-center gap-2 whitespace-nowrap text-left"
        >
          <span className="text-[11.5px] text-emerald-400">当前</span>
          <span className="truncate text-foreground/70">{current.folder}</span>
          <span className="text-muted-foreground/50">›</span>
          <span className="font-semibold text-foreground">
            <ProductLabel name={current.project} />
          </span>
          <span className="text-muted-foreground/50">›</span>
          <span className="w-[38px] shrink-0 rounded bg-foreground/10 text-center text-[10px] leading-4 text-muted-foreground">
            {current.worktree ? "tree" : "主目录"}
          </span>
          <span className="truncate text-foreground/80">{current.name}</span>
        </button>
        <span className="ml-auto">{tail}</span>
      </div>
    );
  return (
    <div
      className={cn(GRID, "h-8 items-center px-4 pb-1 text-[12.5px]")}
      style={cols}
    >
      <button
        type="button"
        title={repoTitle}
        onClick={() => onOpenRepo?.()}
        className="col-span-4 grid cursor-pointer grid-cols-subgrid items-center text-left"
      >
        <Cells
          current
          label={<span className="text-emerald-400">当前</span>}
          row={{
            folder: current.folder,
            product: current.project,
            branch: current.name,
            worktree: !!current.worktree,
          }}
        />
      </button>
      {tail}
    </div>
  );
}

// v2:默认从 4 条改成 2 条,换个名字让之前调过的回到新默认
const COUNT_KEY = "terax.composer.recentCount.v2";
const MODE_KEY = "terax.composer.recentMode";

export type RecentMode = "below" | "popup";

function loadCount(): number {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 2;
  } catch {
    return 2;
  }
}

function loadMode(): RecentMode {
  try {
    return localStorage.getItem(MODE_KEY) === "popup" ? "popup" : "below";
  } catch {
    return "below";
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存不下就只在这次会话里生效
  }
}

/**
 * 最近项目的显示偏好,记在本地:几条(1~10,默认 2);放哪 —— 列在输入框
 * 下面("below"),还是只在工具栏的"最近"按钮里、悬停弹出("popup")。
 * 在"最近"按钮的弹层顶上设置。
 */
export const useRecentPrefs = create<{
  count: number;
  mode: RecentMode;
  setCount: (n: number) => void;
  setMode: (m: RecentMode) => void;
}>((set) => ({
  count: loadCount(),
  mode: loadMode(),
  setCount: (n) => {
    const count = Math.min(10, Math.max(1, n));
    save(COUNT_KEY, String(count));
    set({ count });
  },
  setMode: (mode) => {
    save(MODE_KEY, mode);
    set({ mode });
  },
}));

/** 最近几个项目各自的未提交文件数:打开时查一次,之后每 15 秒、窗口切回来时再查。 */
function useChangedCounts(paths: readonly string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split("\n");
    const read = () => {
      void Promise.all(
        list.map((p) =>
          native
            .gitStatus(p)
            .then((st) => [p, st.changedFiles.length] as const)
            .catch(() => [p, 0] as const),
        ),
      ).then((pairs) => {
        if (!alive) return;
        const next = Object.fromEntries(pairs);
        setCounts((cur) =>
          list.every((p) => cur[p] === next[p]) ? cur : next,
        );
      });
    };
    read();
    const timer = window.setInterval(read, 15000);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [key]);
  return counts;
}

// 不用红绿灯,直接写中文:一眼就懂,不用记哪个颜色是什么意思
const STATE_TEXT = {
  working: "进行中",
  attention: "等你确认",
  finished: "已完成",
  error: "出错",
  disconnected: "未连接",
} as const;
const STATE_CLASS = {
  working: "text-sky-400/90",
  attention: "text-amber-400 animate-pulse",
  finished: "text-emerald-400/90",
  error: "text-red-400",
  disconnected: "text-muted-foreground/60",
} as const;

/**
 * 一行最右边:未提交数、AI 状态(中文:等你确认 / 进行中 / 已完成;聊天会话的
 * 优先,其次命令行里检测到的),没有就空着。
 */
/** 这个工程的 AI 状态:聊天会话的(等确认/在跑/刚做完)优先,其次命令行里检测到的。 */
function useProjectState(path: string | null) {
  const ptyIds = useProjectPanes((s) => s.ptyIds);
  const leafIds = useProjectPanes((s) => (path ? s.leafIds[path] : undefined));
  const chat = useLeavesChatState(leafIds);
  const cli = useProjectAgentState(path, ptyIds);
  return chat ?? cli;
}

/** 只有状态那几个字(当前项目那行用)。 */
function StateLabel({ path }: { path: string | null }) {
  const state = useProjectState(path);
  const leafIds = useProjectPanes((s) => (path ? s.leafIds[path] : undefined));
  if (!state) return null;
  if (state === "finished")
    return (
      <button
        type="button"
        title="点一下标记已看,去掉提醒(发下一条消息也会自动去掉)"
        onClick={() => clearChatFinished(leafIds ?? [])}
        className={cn(
          "cursor-pointer whitespace-nowrap rounded px-1 text-[11.5px] hover:bg-foreground/10",
          STATE_CLASS[state],
        )}
      >
        {STATE_TEXT[state]}
      </button>
    );
  return (
    <span className={cn("whitespace-nowrap text-[11.5px]", STATE_CLASS[state])}>
      {STATE_TEXT[state]}
    </span>
  );
}

function RowStatus({ path, changed }: { path: string; changed: number }) {
  const state = useProjectState(path);
  const leafIds = useProjectPanes((s) => s.leafIds[path]);
  return (
    <>
      {changed > 0 && (
        <span className="whitespace-nowrap text-[11px] tabular-nums text-amber-500/80">
          {changed} 个未提交
        </span>
      )}
      {state && (
        <span
          className={cn("whitespace-nowrap text-[11px]", STATE_CLASS[state])}
        >
          {STATE_TEXT[state]}
        </span>
      )}
      {/* 已完成:停在这行时出一个"已看",点了去掉提醒(行本身是 button,用 span 接点击) */}
      {state === "finished" && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: 发下一条消息也会自动去掉
        // biome-ignore lint/a11y/noStaticElementInteractions: button 里套不了 button
        <span
          title="标记已看,去掉提醒"
          onClick={(e) => {
            e.stopPropagation();
            clearChatFinished(leafIds ?? []);
          }}
          className="invisible whitespace-nowrap rounded px-1 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground group-hover:visible"
        >
          已看
        </span>
      )}
    </>
  );
}

/**
 * 最近用过的几个(不含当前),最近的在最上面,点了切过去;每行停上去右边
 * 一个 × 单个去掉(只删记录,不关终端)。列在输入框下面时和上面的当前项目
 * 共用列宽,上下对齐。
 */
export function RecentProjectRows({
  current,
  inPopup = false,
  onPicked,
}: {
  current: RepoBranch;
  inPopup?: boolean;
  /** 选中一个切过去之后(弹层里用来顺手关掉弹层)。 */
  onPicked?: () => void;
}) {
  const order = useRecentSwitchStore((s) => s.order);
  const groups = useRecentSwitchStore((s) => s.groups);
  const active = useRecentSwitchStore((s) => s.active);
  const open = useRecentSwitchStore((s) => s.open);
  const remove = useRecentSwitchStore((s) => s.remove);
  const count = useRecentPrefs((s) => s.count);
  const cols = useColumns(current);
  const recent = order.filter((p) => p !== active).slice(0, count);
  const changed = useChangedCounts(recent);
  if (recent.length === 0)
    return inPopup ? (
      <div className="px-4 py-4 text-center text-[12px] text-muted-foreground/70">
        还没有最近的项目
      </div>
    ) : null;
  return (
    <div
      className={cn(
        GRID,
        inPopup
          ? "gap-y-0.5 px-3 pb-2"
          : // 输入框下面这块是次要的:整体淡下去、字小一号,鼠标移上来才亮
            "px-4 pt-1.5 text-[11.5px] opacity-55 transition-opacity hover:opacity-100",
      )}
      style={cols}
    >
      {recent.map((path) => (
        <button
          key={path}
          type="button"
          title={path}
          onClick={() => {
            open(path);
            onPicked?.();
            focusChatInputSoon();
          }}
          className={cn(
            "group col-span-5 grid cursor-pointer grid-cols-subgrid items-center text-left text-muted-foreground/80 transition-colors hover:text-emerald-400",
            inPopup ? "h-7 text-[13px]" : "h-[22px]",
          )}
        >
          <Cells
            current={false}
            row={rowOf(path, groups)}
            label={
              <span className="tabular-nums">
                {usedAgo(recentRow(groups, path)?.usedAt)}
              </span>
            }
          />
          <span className="flex items-center justify-end gap-2">
            <RowStatus path={path} changed={changed[path] ?? 0} />
            {/* 行本身是 button,里面不能再套 button:用 span 接住点击 */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: 弹层里的"一键清空"也能清 */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: 见上,button 里套不了 button */}
            <span
              title="从最近里去掉(不关终端)"
              onClick={(e) => {
                e.stopPropagation();
                remove(path);
              }}
              className="invisible rounded px-1.5 text-[13px] leading-5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground group-hover:visible"
            >
              ×
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * 工具栏上的"最近"按钮(固定在"快捷指令"前面):点一下打开,弹出最近的项目,
 * 顶上一排设置 —— 是否同时列在输入框下面、显示几条、一键清空。再点一次、
 * 点外面或按 Esc 关掉。
 */
export function RecentButton({
  labelClass,
  current,
}: {
  labelClass: string;
  current: RepoBranch | null;
}) {
  const [shown, setShown] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  const mode = useRecentPrefs((s) => s.mode);
  const setMode = useRecentPrefs((s) => s.setMode);
  const count = useRecentPrefs((s) => s.count);
  const setCount = useRecentPrefs((s) => s.setCount);
  const clearAll = useRecentSwitchStore((s) => s.clear);

  // 和输入框一样宽、对齐输入框:弹层挂在 body 上(画在聊天区里会被裁掉)
  useLayoutEffect(() => {
    if (!shown) {
      setPos(null);
      return;
    }
    const a = anchorRef.current?.getBoundingClientRect();
    const box = anchorRef.current
      ?.closest("[data-composer-root]")
      ?.querySelector("[data-composer-box]")
      ?.getBoundingClientRect();
    if (!a) return;
    const margin = 12;
    // 至少和输入框一样宽,内容更宽就按内容(名字写全,不折行);以输入框为准居中
    const content = popRef.current?.scrollWidth ?? 0;
    const width = Math.min(
      Math.max(box?.width ?? 720, content),
      window.innerWidth - margin * 2,
    );
    const center = box ? box.left + box.width / 2 : a.right - width / 2;
    const left = Math.max(
      margin,
      Math.min(center - width / 2, window.innerWidth - margin - width),
    );
    setPos({ left, bottom: window.innerHeight - a.top + 6, width });
  }, [shown]);

  // 点外面任何地方都关:按下就关(pointerdown 比 mousedown 早,终端画布这类
  // 自己处理鼠标的也拦得到);点到内嵌网页那种收不到事件的,窗口失焦也关;Esc 关
  useEffect(() => {
    if (!shown) return;
    const close = () => setShown(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    };
  }, [shown]);

  const stepBtn =
    "flex size-6 cursor-pointer items-center justify-center rounded-md border border-foreground/15 bg-foreground/[0.05] text-[14px] leading-none text-foreground/80 hover:border-sky-400/50 hover:text-sky-400";
  const below = mode === "below";
  // "只在这里"时鼠标停上去就弹(没有别处能看最近的);列在输入框下面时点开就行。
  // 移开稍等一下再收,从按钮挪进弹层的路上不至于闪没(弹层是 portal,React 的
  // 进出事件按组件树算,进到弹层不算离开)
  const hoverTimer = useRef<number | null>(null);
  const clearHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => clearHover, []);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬停展开只是捷径,按钮本身可点
    <div
      ref={anchorRef}
      className="relative"
      onMouseEnter={() => {
        if (below) return;
        clearHover();
        setShown(true);
      }}
      onMouseLeave={() => {
        if (below) return;
        clearHover();
        hoverTimer.current = window.setTimeout(() => setShown(false), 250);
      }}
    >
      <button
        type="button"
        title="最近的项目"
        onClick={() => setShown((v) => !v)}
        className={cn(
          "flex h-7 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12px] transition-colors hover:bg-foreground/10 hover:text-foreground",
          shown ? "bg-foreground/10 text-foreground" : "text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.75} />
        <span className={labelClass}>最近</span>
      </button>
      {shown && <Dim />}
      {shown &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-50 w-max rounded-xl border border-foreground/35 bg-background shadow-[0_24px_70px_rgba(0,0,0,0.75)]"
            style={{
              left: pos?.left ?? 0,
              bottom: pos?.bottom ?? 0,
              width: pos?.width,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            <div className="flex items-center gap-4 border-b border-foreground/10 px-4 py-2.5 text-[12.5px] text-muted-foreground">
              <span className="font-semibold text-foreground/90">最近一周</span>
              {/* 二选一:开着就同时列在输入框下面,关掉就只在这个按钮里 */}
              <button
                type="button"
                role="switch"
                aria-checked={below}
                onClick={() => setMode(below ? "popup" : "below")}
                className="flex cursor-pointer items-center gap-2 hover:text-foreground"
              >
                列在输入框下面
                <span
                  className={cn(
                    "relative h-[18px] w-8 rounded-full transition-colors",
                    below ? "bg-emerald-500/80" : "bg-foreground/20",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-3.5 rounded-full bg-white transition-all",
                      below ? "left-4" : "left-0.5",
                    )}
                  />
                </span>
              </button>
              <span className="flex items-center gap-1.5">
                显示 {count} 条
                <button
                  type="button"
                  title="少显示一条"
                  onClick={() => setCount(count - 1)}
                  className={stepBtn}
                >
                  −
                </button>
                <button
                  type="button"
                  title="多显示一条"
                  onClick={() => setCount(count + 1)}
                  className={stepBtn}
                >
                  +
                </button>
              </span>
              <button
                type="button"
                title="清空使用记录(不会关掉终端),之后切过去的才重新出现"
                onClick={clearAll}
                className="ml-auto cursor-pointer rounded px-1.5 py-0.5 hover:text-sky-400"
              >
                一键清空
              </button>
            </div>
            {current && (
              <div className="py-2 text-[13px]">
                <RecentProjectRows
                  current={current}
                  inPopup
                  onPicked={() => setShown(false)}
                />
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
