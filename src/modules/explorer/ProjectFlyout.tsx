import { cn } from "@/lib/utils";
import {
  branchSearchKey,
  matchesBranchQuery,
} from "@/modules/android-run/lib/branchFilter";
import type { ProjectKind } from "@/modules/android-run/lib/projectKind";
import {
  type ProjectGitInfo,
  useProjectGitInfo,
} from "@/modules/android-run/lib/useProjectWorktrees";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dim } from "./Dim";
import { useProductAlias, useProductAliases } from "./lib/productAliases";
import {
  moveGroup,
  moveToGroup,
  type ProductGroup,
  resolveLayout,
  useProductGroups,
  useTiledFolders,
} from "./lib/productOrder";
import { loadRecentTimes } from "./lib/recentProjects";
import type { DirEntry } from "./lib/useFileTree";

export type FlyoutAnchor = {
  folder: string;
  /** 弹层左上角(视口坐标):贴着左栏右边缘、和目录行对齐。 */
  left: number;
  top: number;
};

/** sub:平铺模式下产品所在的客户目录名(普通模式为空)。 */
type Product = {
  path: string;
  name: string;
  sub?: string;
};

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

const EMPTY_GIT: Record<string, ProjectGitInfo> = {};

/** 刚拖完松手的时间:松手时浏览器还会补发一个 click,别把它当成"打开"。 */
let lastDragEnd = 0;

/** 上次切过去是多久以前(和"最近"菜单同一套说法)。 */
function usedAgo(at: number | undefined): string {
  if (!at) return "";
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return `${Math.floor(min / 60)} 小时前`;
  if (at >= today.getTime() - 86400000) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

/**
 * 看过的目录记一份(产品列表 + 各产品的分支/worktree):再停到同一个目录上
 * 直接用它画,不用等;后台照样重读一遍,有变化再换上。
 */
const folderCache = new Map<
  string,
  { products: Product[]; git: Record<string, ProjectGitInfo> }
>();

/** 目录下的产品:读一层子目录,挨个问是不是工程(结果有缓存,不会每次都查)。 */
function useFolderProducts(
  folder: string | null,
  classify: (path: string) => Promise<ProjectKind | null>,
  tiled: boolean,
): Product[] | null {
  const key = folder ? (tiled ? `${folder}#tiled` : folder) : null;
  const [state, setState] = useState<{
    key: string;
    products: Product[];
  } | null>(null);
  useEffect(() => {
    if (!folder || !key) return;
    let alive = true;
    // 一层子目录里是工程的那些
    const productsIn = async (dir: string, sub?: string) => {
      const entries = await invoke<DirEntry[]>("fs_read_dir", {
        path: dir,
        showHidden: false,
        gitDecorations: false,
        workspace: currentWorkspaceEnv(),
      }).catch(() => [] as DirEntry[]);
      const dirs = entries
        .filter((e) => e.kind === "dir")
        .map((e) => ({
          path: `${dir}/${e.name}`,
          name: e.name,
          sub,
        }));
      const kinds = await Promise.all(dirs.map((d) => classify(d.path)));
      return {
        products: dirs.filter((_, i) => kinds[i]),
        others: dirs.filter((_, i) => !kinds[i]),
      };
    };
    void (async () => {
      const top = await productsIn(folder);
      let products: Product[] = top.products;
      // 平铺:再往下一层,每个客户目录里的产品都拿出来,记上是哪家的
      if (tiled) {
        const nested = await Promise.all(
          top.others.map((d) => productsIn(d.path, d.name)),
        );
        products = [...products, ...nested.flatMap((n) => n.products)];
      }
      if (alive) setState({ key, products });
    })();
    return () => {
      alive = false;
    };
  }, [folder, key, tiled, classify]);
  if (state && state.key === key) return state.products;
  return (key && folderCache.get(key)?.products) || null;
}

/**
 * 一个产品一张卡片:标题(序号 + 中文名 + 英文名)只用来拖拽排序、改中文名,
 * 点了不打开;下面一行"主目录"和各个 worktree 才是点了打开的。
 */
function ProductCard({
  index,
  product,
  branch,
  worktrees,
  active,
  times,
  onOpen,
  dragging,
  dropTarget,
  onDragStart,
  flat = false,
}: {
  index: number;
  product: Product;
  branch: string | null;
  worktrees: { path: string; label: string }[];
  active: string | null;
  opened: ReadonlySet<string> | undefined;
  times: Record<string, number>;
  onOpen: (path: string) => void;
  dragging: boolean;
  /** 拖到这张卡片上:蓝线画在它上面("before")还是下面("after")。 */
  dropTarget: "before" | "after" | null;
  onDragStart: (e: React.PointerEvent, name: string) => void;
  /** 平铺模式:外面已经有项目大框,产品就不再套框、不加底色(框套框太晃眼)。 */
  flat?: boolean;
}) {
  const alias = useProductAlias(product.name);
  const setAlias = useProductAliases((s) => s.setAlias);
  const [editing, setEditing] = useState(false);
  // 没有 worktree 的(大多数):不单列"主目录",分支跟在标题后面,点标题就开;
  // 有 worktree 才列"主目录"一行 + 各个 tree,标签对齐分得清
  const single = worktrees.length === 0;
  const rows = single
    ? []
    : [
        {
          path: product.path,
          tag: "主目录",
          // 分支还没查回来就只留"主目录"标签,别写成"主目录 主目录"
          label: branch ?? "",
        },
        ...worktrees.map((w) => ({
          path: w.path,
          tag: "tree",
          label: w.label,
        })),
      ];
  const mainActive = product.path === active;
  const mainAgo = usedAgo(times[product.path]);
  return (
    <div data-product-card={product.name} className="relative">
      {/* 插入位置:两张卡片之间的空隙正中一条直的蓝线(卡片间距 8px,线居中) */}
      {dropTarget && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-sky-400",
            dropTarget === "before" ? "-top-[5px]" : "-bottom-[5px]",
          )}
        />
      )}
      <div
        className={cn(
          "overflow-hidden transition-opacity",
          !flat && cn("rounded-lg border", "border-foreground/[0.08]"),
          dragging && "opacity-40",
        )}
      >
        {editing ? (
          <div className="flex min-h-10 items-center gap-2 bg-foreground/[0.035] px-2.5">
            <span className="text-[11px] text-muted-foreground">中文名</span>
            <input
              // biome-ignore lint/a11y/noAutofocus: 点了铅笔就是要输入
              autoFocus
              defaultValue={alias ?? ""}
              placeholder="比如:取盘机,留空就只显示英文名"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  setAlias(product.name, e.currentTarget.value);
                  setEditing(false);
                } else if (e.key === "Escape") setEditing(false);
              }}
              onBlur={(e) => {
                setAlias(product.name, e.currentTarget.value);
                setEditing(false);
              }}
              className="h-6 w-48 rounded border border-border bg-background px-2 text-[12.5px] outline-none focus:border-foreground/40"
            />
            <span className="text-[11px] text-muted-foreground/70">
              {product.name} · 回车保存
            </span>
          </div>
        ) : (
          // 标题:按住拖动排顺序;没有 worktree 时轻点一下就打开主目录
          // (挪过 5px 才算拖,点一下不会被当成拖)
          // biome-ignore lint/a11y/useKeyWithClickEvents: 主目录右键菜单/左栏也能开,键盘用户不受影响
          <div
            title={
              single
                ? `${product.path}\n点击打开,按住拖动调整顺序`
                : "按住拖动调整顺序"
            }
            onPointerDown={(e) => onDragStart(e, product.name)}
            onClick={
              single
                ? () => {
                    if (Date.now() - lastDragEnd < 300) return;
                    onOpen(product.path);
                  }
                : undefined
            }
            className={cn(
              "group/head flex min-h-10 touch-none select-none items-center gap-2 py-1.5 pl-2.5",
              single ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
              !flat && rows.length > 0 && "bg-foreground/[0.035]",
            )}
          >
            <span
              className={cn(
                // 序号就是一个灰色数字,不加方块
                "w-4 shrink-0 text-right text-[11.5px] tabular-nums",
                "text-muted-foreground/60",
              )}
            >
              {index}
            </span>
            <span className="flex flex-col leading-tight">
              <span
                className={cn(
                  "text-[14px] font-semibold transition-colors",
                  "text-foreground",
                  mainActive && single && "font-bold",
                  single && "group-hover/head:text-sky-400",
                )}
              >
                {alias ?? product.name}
              </span>
              {alias && (
                <span className="text-[11px] text-muted-foreground/80">
                  {product.name}
                </span>
              )}
            </span>
            {/* 没有 worktree 的也带"主目录"标签,和有 worktree 的卡片看着一致 */}
            {single && (
              <span className="ml-2 flex items-center gap-2 self-end pb-px">
                <span
                  className={cn(
                    "w-[38px] shrink-0 rounded text-center text-[10px] font-normal leading-4",
                    "bg-foreground/10 text-muted-foreground/80",
                  )}
                >
                  主目录
                </span>
                {branch && (
                  <span className={cn("text-[12px]", "text-muted-foreground")}>
                    {branch}
                  </span>
                )}
              </span>
            )}
            <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground/70">
              {single ? mainAgo : ""}
            </span>
            <button
              type="button"
              title="设置中文名"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                // 别冒到标题上被当成"打开"
                e.stopPropagation();
                setEditing(true);
              }}
              className="mr-1.5 ml-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover/head:opacity-100"
            >
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={13}
                strokeWidth={1.75}
              />
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex flex-col py-1">
            {rows.map((r) => {
              const rActive = r.path === active;
              const ago = usedAgo(times[r.path]);
              return (
                <button
                  key={r.path}
                  type="button"
                  title={r.path}
                  onClick={() => onOpen(r.path)}
                  className={cn(
                    "flex h-7 w-full cursor-pointer items-center gap-2 whitespace-nowrap pr-3 pl-[34px] text-left text-[12.5px] transition-colors hover:text-sky-400",
                    "text-foreground/75",
                    rActive && "font-semibold",
                  )}
                >
                  <span
                    className={cn(
                      // 主目录 / tree 一样宽、居中,后面的分支名对齐
                      "w-[38px] shrink-0 rounded text-center text-[10px] font-normal leading-4",
                      "bg-foreground/10 text-muted-foreground/80",
                    )}
                  >
                    {r.tag}
                  </span>
                  {r.label}
                  {ago && (
                    <span className="ml-auto pl-4 text-[11px] font-normal tabular-nums text-muted-foreground/70">
                      {ago}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 分组名:点一下就能改;空分组右边一个 × 删掉。 */
function GroupTitle({
  title,
  empty,
  onRename,
  onDelete,
  onGripDown,
}: {
  title: string;
  empty: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** 按住分组名左边的抓手:拖动整个分组换位置。 */
  onGripDown: (e: React.PointerEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: 点了分组名就是要改
        autoFocus
        defaultValue={title}
        placeholder="分组名,比如:秤、网关"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            onRename(e.currentTarget.value.trim());
            setEditing(false);
          } else if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => {
          onRename(e.currentTarget.value.trim());
          setEditing(false);
        }}
        className="h-6 rounded border border-border bg-background px-2 text-[12.5px] outline-none focus:border-foreground/40"
      />
    );
  return (
    <div className="group/title flex h-6 items-center gap-1 px-1">
      <span
        title="按住左右拖动,调整分组顺序"
        onPointerDown={onGripDown}
        className="cursor-grab touch-none select-none px-0.5 text-[12px] leading-none tracking-[-2px] text-muted-foreground/40 transition-colors hover:text-foreground active:cursor-grabbing"
      >
        ⋮⋮
      </span>
      <button
        type="button"
        title="点击改分组名"
        onClick={() => setEditing(true)}
        className={cn(
          "cursor-pointer text-[12.5px] font-semibold transition-colors hover:text-sky-400",
          title ? "text-foreground/85" : "text-muted-foreground/50",
        )}
      >
        {title || "未命名分组"}
      </button>
      {empty && (
        <button
          type="button"
          title="删除这个空分组"
          onClick={onDelete}
          className="ml-auto cursor-pointer rounded px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * 按顺序把产品切成几栏,每栏的行数(产品 1 行 + 它的 worktree)尽量一样多。
 * 不用 CSS 多栏:那个栏宽是定死的,名字长了只能截断;自己分栏后每栏按
 * 最长的名字撑开,名字全部写全。
 */
function splitColumns<T>(items: T[], rows: (t: T) => number, cols: number) {
  const total = items.reduce((n, t) => n + rows(t), 0);
  const per = total / cols;
  const out: T[][] = [[]];
  let acc = 0;
  for (const t of items) {
    const r = rows(t);
    const cur = out[out.length - 1];
    if (cur.length > 0 && acc + r / 2 > per * out.length && out.length < cols)
      out.push([]);
    out[out.length - 1].push(t);
    acc += r;
  }
  return out;
}

/**
 * 左栏目录的悬停弹层:这个目录下的产品一张张卡片,分栏横着铺开(一屏看全,
 * 不用滚);每张卡片顶栏是序号 + 产品名,下面列它全部 worktree。开着终端的
 * 卡片描绿边、名字绿字。点产品或 worktree 直接打开。
 */
export function ProjectFlyout({
  anchor,
  classify,
  active,
  opened,
  onOpen,
  onHoverChange,
}: {
  anchor: FlyoutAnchor | null;
  classify: (path: string) => Promise<ProjectKind | null>;
  active: string | null;
  opened: ReadonlySet<string> | undefined;
  onOpen: (path: string) => void;
  /** 鼠标进出弹层:进来时别收,出去了交给外面延时收起。 */
  onHoverChange: (inside: boolean) => void;
}) {
  const tiled = useTiledFolders((s) =>
    anchor ? s.folders.includes(anchor.folder) : false,
  );
  const products = useFolderProducts(anchor?.folder ?? null, classify, tiled);
  const roots = useMemo(
    () => new Set((products ?? []).map((p) => p.path)),
    [products],
  );
  const liveGit = useProjectGitInfo(roots, { refreshOnFocus: false });
  const folder = anchor?.folder ?? null;
  const cacheKey = folder ? (tiled ? `${folder}#tiled` : folder) : null;
  // worktree 要另跑 git 才知道:产品一读出来就画,卡片会等 git 回来才突然变长,
  // 看着像先折叠再展开。等 git 回来(最多 0.6 秒)再一次画出来;看过的目录用
  // 记下的结果直接画
  const gitArrived = !!products && products.some((p) => p.path in liveGit);
  const [waitedFor, setWaitedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!folder || !products) return;
    const t = window.setTimeout(() => setWaitedFor(folder), 600);
    return () => window.clearTimeout(t);
  }, [folder, products]);
  useEffect(() => {
    if (cacheKey && products && gitArrived)
      folderCache.set(cacheKey, { products, git: liveGit });
  }, [cacheKey, products, gitArrived, liveGit]);
  const cached = cacheKey ? folderCache.get(cacheKey) : undefined;
  // 没查回来、也没缓存时用同一个空对象:每次 new 一个 {},依赖它的布局
  // 量位置 → setPos → 重画 → 又一个新 {} …… 死循环把整个界面搞崩
  const git = gitArrived ? liveGit : (cached?.git ?? EMPTY_GIT);
  const ready = gitArrived || !!cached || waitedFor === folder;
  const times = useMemo(() => (products ? loadRecentTimes() : {}), [products]);

  // 平铺时按项目(客户目录名)搜,支持全拼和拼音首字母
  const [query, setQuery] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 换目录就清空
  useEffect(() => setQuery(""), [folder]);
  const searchKeys = useMemo(() => {
    const keys = new Map<string, ReturnType<typeof branchSearchKey>>();
    for (const p of products ?? [])
      if (!keys.has(p.sub ?? ""))
        keys.set(p.sub ?? "", branchSearchKey(p.sub ?? ""));
    return keys;
  }, [products]);
  const visible = (p: Product) => {
    const key = searchKeys.get(p.sub ?? "");
    return !tiled || !query.trim() || !key || matchesBranchQuery(key, query);
  };

  // 分组(一栏一个):没排过先按高度自动分好;排过就照记下的,固定不动
  const saved = useProductGroups((s) =>
    folder ? s.layouts[folder] : undefined,
  );
  const setLayout = useProductGroups((s) => s.setLayout);
  const groups = useMemo(() => {
    if (!products) return [];
    const names = products.map((p) => p.name);
    const cols = products.length <= 6 ? 1 : products.length <= 14 ? 2 : 3;
    const auto = saved?.length
      ? []
      : splitColumns(
          products,
          (p) => 2.4 + (git[p.path]?.worktrees.length ?? 0),
          cols,
        ).map((col) => col.map((p) => p.name));
    return resolveLayout(names, saved, auto);
  }, [products, saved, git]);
  const saveGroups = (next: ProductGroup[]) => {
    if (folder) setLayout(folder, next);
  };

  // 拖卡片标题:按住挪过 5px 才算拖。落在卡片上看上下半截插它前面/后面
  // (插入处一条蓝线);落在分组的空白处就放到那个分组最后
  const dragRef = useRef(false);
  const [drag, setDrag] = useState<{
    name: string;
    over: string | null;
    after: boolean;
    group: number | null;
  } | null>(null);
  const startDrag = (e: React.PointerEvent, name: string) => {
    if (e.button !== 0 || !folder || !products) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    let over: string | null = null;
    let after = false;
    let group: number | null = null;
    dragRef.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moving = true;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const card = hit?.closest("[data-product-card]");
      const col = hit?.closest("[data-product-group]");
      over = card?.getAttribute("data-product-card") ?? null;
      if (over === name) over = null;
      if (card && over) {
        const r = card.getBoundingClientRect();
        after = ev.clientY > r.top + r.height / 2;
      }
      const g = col?.getAttribute("data-product-group");
      group = g == null ? null : Number(g);
      setDrag({ name, over, after, group });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moving) lastDragEnd = Date.now();
      if (moving && group !== null && (over !== null || !isLastIn(name, group)))
        saveGroups(moveToGroup(groups, name, group, over, after));
      setDrag(null);
      dragRef.current = false;
      // 拖着划出了弹层、在外面松手:松手后照常收起
      const at = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!at || !boxRef.current?.contains(at)) onHoverChange(false);
    };
    // 拖回自己所在分组的空白处(本来就排最后):等于没动
    const isLastIn = (n: string, g: number) => {
      const list = groups[g]?.names ?? [];
      return list[list.length - 1] === n;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 拖分组:按住分组名左边的抓手左右拖,落在哪个分组的左/右半边就插在它
  // 前面/后面,插入处一条竖的蓝线
  const [groupDrag, setGroupDrag] = useState<{
    from: number;
    over: number | null;
    after: boolean;
  } | null>(null);
  const startGroupDrag = (e: React.PointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    let moving = false;
    let over: number | null = null;
    let after = false;
    dragRef.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return;
      moving = true;
      const col = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-product-group]");
      const g = col?.getAttribute("data-product-group");
      over = g == null ? null : Number(g);
      if (col && over !== null) {
        const r = col.getBoundingClientRect();
        after = ev.clientX > r.left + r.width / 2;
      }
      if (over === from) over = null;
      setGroupDrag({ from, over, after });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moving && over !== null)
        saveGroups(moveGroup(groups, from, over, after));
      setGroupDrag(null);
      dragRef.current = false;
      const at = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!at || !boxRef.current?.contains(at)) onHoverChange(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 量出实际大小再定位置。产品少(小弹层):贴着目录名出,放不下往上/往左挪;
  // 产品多(大弹层):在窗口里左右、上下都居中,不会挤出窗口右边
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const margin = 12;
  // biome-ignore lint/correctness/useExhaustiveDependencies: git/products/groups 变了大小会变,要重量
  useLayoutEffect(() => {
    if (!anchor) return;
    const h = boxRef.current?.offsetHeight ?? 0;
    const w = boxRef.current?.offsetWidth ?? 0;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const few = !tiled && (products?.length ?? 0) <= 6;
    const next = few
      ? {
          left: Math.max(margin, Math.min(anchor.left, viewW - margin - w)),
          top: Math.max(margin, Math.min(anchor.top, viewH - margin - h)),
          width: w,
          height: h,
        }
      : {
          left: Math.max(margin, Math.round((viewW - w) / 2)),
          top: Math.max(margin, Math.round((viewH - h) / 2)),
          width: w,
          height: h,
        };
    // 位置没变就不更新,免得量一次就重画一次。平铺时搜索会让弹层变小:
    // 位置定住不再居中(输入框不跟着跳),只更新大小给四周的磨砂用
    setPos((cur) => {
      // 只在搜索打字时定住(不然位置是没长满时算的,展开后会跑出窗口)
      const n =
        tiled && cur && query.trim()
          ? { ...next, left: cur.left, top: cur.top }
          : next;
      return cur &&
        cur.left === n.left &&
        cur.top === n.top &&
        cur.width === n.width &&
        cur.height === n.height
        ? cur
        : n;
    });
  }, [anchor, products, git, ready, groups, tiled, query]);

  if (!anchor || !products || products.length === 0 || !ready) return null;
  const maxWidth = window.innerWidth - margin * 2;
  const byName = new Map(products.map((p) => [p.name, p]));
  let no = 0;
  const numbered = groups.map((g) =>
    g.names.flatMap((n) => {
      const p = byName.get(n);
      return p ? [{ p, no: ++no }] : [];
    }),
  );
  // 平铺:按客户目录分块(目录内按名字),编号接着往下数
  let tno = 0;
  const tileMap = new Map<string, { p: Product; no: number }[]>();
  for (const p of products) {
    const k = p.sub ?? "";
    if (!tileMap.has(k)) tileMap.set(k, []);
    tileMap.get(k)?.push({ p, no: 0 });
  }
  const allTiles = [...tileMap].map(([sub, items]) => ({
    sub,
    items: items.map((it) => ({ ...it, no: ++tno })),
  }));
  // 项目太多,不全铺:没搜索时只出最近切过去的 9 个(三栏三行)(没切过的排后面、
  // 按名字);其余靠搜索
  const TILE_LIMIT = 9;
  const tileRank = (t: (typeof allTiles)[number]) =>
    Math.max(
      0,
      // 只看在软件里最后一次切过去的时间(worktree 的也算在它的项目上);
      // 文件夹修改时间不准:深层文件改了,外层文件夹时间不变
      ...t.items.flatMap(({ p }) => [
        times[p.path] ?? 0,
        ...Object.entries(times)
          .filter(([k]) => k.startsWith(`${p.path}/.worktree/`))
          .map(([, v]) => v),
      ]),
    );
  const matchedTiles = allTiles
    .map((t) => ({ ...t, items: t.items.filter(({ p }) => visible(p)) }))
    .filter((t) => t.items.length > 0);
  const searching = !!query.trim();
  const tiles = searching
    ? matchedTiles
    : [...matchedTiles]
        .sort((a, b) => tileRank(b) - tileRank(a))
        .slice(0, TILE_LIMIT);
  const hiddenTiles = matchedTiles.length - tiles.length;
  const viewH = window.innerHeight;
  const y = pos?.top ?? anchor.top;

  return (
    <>
      <Dim />
      {createPortal(
        // biome-ignore lint/a11y/noStaticElementInteractions: 悬停展开,里面的行都是 button
        <div
          ref={boxRef}
          onMouseEnter={() => onHoverChange(true)}
          // 拖卡片时鼠标可能划出弹层,拖着的时候不收
          onMouseLeave={() => {
            if (!dragRef.current) onHoverChange(false);
          }}
          // 底色和主界面一样(不用 popover 那层亮一档的灰),靠边框和阴影浮起来
          // 实色底 + 深阴影 + 亮一点的边框浮在上面;不再给四周加磨砂(半糊半清的看着乱)
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-foreground/35 bg-background shadow-[0_24px_70px_rgba(0,0,0,0.75)]"
          style={{
            left: pos?.left ?? anchor.left,
            top: y,
            maxWidth,
            // 限高按整个窗口算(不按当前 top):量出来的才是真实高度,再决定往上挪多少
            maxHeight: viewH - margin * 2,
          }}
        >
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 pt-2.5 pb-2 text-[11.5px]">
            <span className="font-semibold text-foreground/85">
              {baseName(anchor.folder)}
            </span>
            {tiled && (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setQuery("");
                }}
                // 平铺时主要靠搜索:一打开就能直接打字
                // biome-ignore lint/a11y/noAutofocus: 平铺弹层就是拿来搜的
                autoFocus
                placeholder="搜索项目,支持拼音首字母"
                className="ml-3 h-7 w-64 rounded-md border border-foreground/15 bg-foreground/[0.04] px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-sky-400/60"
              />
            )}
            {!tiled && (
              <button
                type="button"
                onClick={() =>
                  saveGroups([...groups, { title: "", names: [] }])
                }
                className="ml-auto cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-sky-400"
              >
                ＋ 新建分组
              </button>
            )}
          </div>
          {tiled ? (
            // 平铺:一个客户目录一块(目录名 + 它的产品卡片),多栏铺开,一屏看全
            <div
              className="min-h-0 overflow-auto px-2.5 pb-2.5"
              // 宽度按客户目录数量给:少就窄,多了最多三栏、再多往下排
              style={{
                columnWidth: 330,
                columnGap: 12,
                width: Math.min(
                  maxWidth,
                  Math.min(Math.max(tiles.length, 1), 3) * 342 + 20,
                ),
              }}
            >
              {tiles.map((t) => (
                // 一个项目一个大框:项目名是框的顶栏,它的产品卡片都装在框里
                <div
                  key={t.sub}
                  className="mb-3 inline-block w-full break-inside-avoid overflow-hidden rounded-xl border border-foreground/15 bg-foreground/[0.025]"
                >
                  <div className="flex items-center gap-1.5 border-b border-foreground/10 bg-foreground/[0.06] px-3 py-2.5 text-[15px] font-bold text-foreground">
                    <span className="text-muted-foreground/70">📁</span>
                    {t.sub || baseName(anchor.folder)}
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground/70">
                      {t.items.length} 个产品
                    </span>
                  </div>
                  {/* 产品之间一道细线,不再一个个套框 */}
                  <div className="flex flex-col divide-y divide-foreground/[0.07] px-1">
                    {t.items.map(({ p, no }) => (
                      <ProductCard
                        key={p.path}
                        index={no}
                        product={p}
                        branch={git[p.path]?.branch ?? null}
                        worktrees={(git[p.path]?.worktrees ?? []).map((w) => ({
                          path: w.path.replace(/[\\/]+$/, ""),
                          label: w.branch || w.name,
                        }))}
                        active={active}
                        opened={opened}
                        times={times}
                        onOpen={onOpen}
                        dragging={false}
                        dropTarget={null}
                        onDragStart={() => {}}
                        flat
                      />
                    ))}
                  </div>
                </div>
              ))}
              {hiddenTiles > 0 && (
                <div className="px-1 pt-1 text-[12px] text-muted-foreground/70">
                  还有 {hiddenTiles} 个项目,输入搜索查看
                </div>
              )}
              {searching && tiles.length === 0 && (
                <div className="px-1 py-6 text-center text-[12.5px] text-muted-foreground/70">
                  没有找到"{query.trim()}"
                </div>
              )}
            </div>
          ) : (
            /* 一个分组一栏,并排一屏看全;每栏按里面最长的名字撑开,窗口放不下就左右滚 */
            <div className="flex min-h-0 items-start gap-3 overflow-auto px-2.5 pb-2.5">
              {groups.map((g, gi) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: 分组没有自己的 id,顺序就是身份
                  key={gi}
                  data-product-group={gi}
                  className={cn(
                    "relative flex w-max min-w-56 flex-col gap-2 self-stretch rounded-lg transition-opacity",
                    drag &&
                      drag.group === gi &&
                      !drag.over &&
                      "bg-sky-400/[0.06]",
                    groupDrag?.from === gi && "opacity-40",
                  )}
                >
                  {/* 拖分组时的插入位置:两栏之间空隙正中一条竖的蓝线 */}
                  {groupDrag?.over === gi && (
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-sky-400",
                        groupDrag.after ? "-right-[7px]" : "-left-[7px]",
                      )}
                    />
                  )}
                  <GroupTitle
                    title={g.title}
                    empty={g.names.length === 0}
                    onRename={(title) =>
                      saveGroups(
                        groups.map((x, i) => (i === gi ? { ...x, title } : x)),
                      )
                    }
                    onDelete={() =>
                      saveGroups(groups.filter((_, i) => i !== gi))
                    }
                    onGripDown={(e) => startGroupDrag(e, gi)}
                  />
                  {numbered[gi]
                    .filter(({ p }) => visible(p))
                    .map(({ p, no }) => (
                      <ProductCard
                        key={p.path}
                        index={no}
                        product={p}
                        branch={git[p.path]?.branch ?? null}
                        worktrees={(git[p.path]?.worktrees ?? []).map((w) => ({
                          path: w.path.replace(/[\\/]+$/, ""),
                          label: w.branch || w.name,
                        }))}
                        active={active}
                        opened={opened}
                        times={times}
                        onOpen={onOpen}
                        dragging={drag?.name === p.name}
                        dropTarget={
                          drag?.over === p.name
                            ? drag.after
                              ? "after"
                              : "before"
                            : null
                        }
                        onDragStart={startDrag}
                      />
                    ))}
                  {g.names.length === 0 && (
                    <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-foreground/15 px-4 text-[12px] text-muted-foreground/70">
                      拖产品到这里
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
