import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IS_WINDOWS } from "@/lib/platform";
import { useArmedConfirm } from "@/lib/useArmedConfirm";
import { cn } from "@/lib/utils";
import { type GitStatusSnapshot, native } from "@/modules/ai/lib/native";
import {
  CopyProjectDialog,
  getProjectLink,
  getTaskLink,
  listProjectLinkDirs,
  type ProjectGitInfo,
  type ProjectKind,
  type ProjectWorktree,
} from "@/modules/android-run";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useGlobalShortcuts } from "@/modules/shortcuts";
import { ChangedFilesDialog } from "@/modules/source-control/ChangedFilesDialog";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  FileAddIcon,
  FileEditIcon,
  FilterHorizontalIcon,
  Folder01Icon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { DirSearchPopover } from "./DirSearchPopover";
import {
  type ExplorerHeaderAction,
  ExplorerHeaderActions,
} from "./ExplorerHeaderActions";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { InlineInput } from "./InlineInput";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import type { GitStatusCode } from "./lib/gitStatusUtils";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import {
  loadPinnedDirs,
  PINNED_DIRS_CHANGED_EVENT,
  pinnedKey,
  setPinnedDir,
  togglePinnedDir,
} from "./lib/pinnedDirs";
import { useExplorerDnd } from "./lib/useExplorerDnd";
import { useExplorerFileDrop } from "./lib/useExplorerFileDrop";
import { useFileTree } from "./lib/useFileTree";
import { useGitStatus } from "./lib/useGitStatus";
import {
  EntryRow,
  PendingRow,
  type RowActions,
  StatusRow,
  WorktreeRow,
} from "./TreeRow";

export type FileExplorerHandle = {
  focus: () => void;
  isFocused: () => boolean;
  focusSearch: () => void;
  /** Expand every ancestor of `path` and scroll it into view. */
  revealPath: (path: string) => void;
};

type Props = {
  rootPath: string | null;
  activeFilePath?: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  /** Force-open a brand-new terminal (no dedup), even if one already exists. */
  onOpenNewTerminal?: (path: string) => void;
  /** Async check: which runnable project this dir is (null = plain folder).
   * A hit gets the 工程 treatment: kind-specific icon, no expand, click opens
   * a terminal tab. */
  classifyProjectDir?: (path: string) => Promise<ProjectKind | null>;
  /** Click handler for a detected 安卓工程 dir (opens/locates its terminal). */
  onOpenProject?: (path: string) => void;
  /** 当前打开的产品路径,在树中用醒目底色高亮。 */
  activeProjectPath?: string | null;
  /** 已有终端 tab 打开的工程路径集合,在树中用绿色字体标出。 */
  openedProjectPaths?: Set<string>;
  /** 工程根 -> 该工程下所有终端 tab 的 pty id,驱动 Claude Code 状态灯。 */
  projectPtyIds?: Record<string, number[]>;
  /** 工程根 -> git 概况:行尾显示当前分支,worktree 画成工程的子行。 */
  projectGitByPath?: Record<string, ProjectGitInfo>;
  onOpenInSourceControl?: (path: string) => void;
  onOpenGitHistory?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  /** 把这个目录设为当前 Space 的根目录(左栏"产品目录"专用)。 */
  onSetAsRoot?: (path: string) => void;
  /** 额外塞进头部按钮行的动作(比如产品文件区的开合开关)。排在自带按钮后面,
   * 也就是宽度不够时比它们更早被收进 ⋯ 菜单。 */
  headerActions?: ExplorerHeaderAction[];
  /** 给这个工程填"当前云效需求"地址(跟着仓库走,不继承)。 */
  onLinkYunxiaoTask?: (path: string) => void;
  /** 给这个产品目录绑云效项目(底下的工程继承)。 */
  onLinkYunxiaoProject?: (path: string) => void;
  /** 解除这个目录的云效项目绑定。 */
  onUnlinkYunxiaoProject?: (path: string) => void;
  /** 云效项目绑定变更信号,变了就重算哪些目录该挂云图标。 */
  linkVersion?: number;
  pathDropTarget?: TerminalPathDropTarget;
  gitStatus?: GitStatusSnapshot | null;
  /** 有未保存编辑的文件(编辑器里改了没存),树上单独标一下 —— git 还看不见它们。 */
  dirtyPaths?: Set<string>;
};

type Row =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
      pinned: boolean;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
      gitignored: boolean;
      gitStatusCode: GitStatusCode | null;
    }
  | { kind: "pending"; key: string; depth: number; pendingKind: "file" | "dir" }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    }
  | {
      /** 工程下挂的 worktree,点击当独立工程打开(自己的终端/投屏)。 */
      kind: "worktree";
      key: string;
      path: string;
      name: string;
      branch: string;
      depth: number;
    };

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function parentOf(path: string, fallback: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : fallback;
}

/** Parent of a root path, or null at the filesystem root (nothing above "/",
 * and nothing above a Windows drive root — "D:" 的上一级不存在,盘符之间
 * 是并列的根,切盘走头部的盘符菜单)。 */
function parentDir(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(trimmed)) return null; // Windows 盘符根
  const i = trimmed.lastIndexOf("/");
  if (i < 0) return null;
  if (i === 0) return "/";
  const parent = trimmed.slice(0, i);
  // "D:/sub" 的上一级要带斜杠:裸 "D:" 在 Windows 是"盘相对路径",
  // 指向进程在 D 盘的当前目录,不是盘根。
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
  lookup: (path: string) => GitStatusCode | null,
  /** 非空 = 只保留这些路径(以及它们的父目录),其余整棵子树都不画。 */
  keep: Set<string> | null,
  /** 目录下挂的 worktree(只有已打开的工程才有),画成子行。 */
  worktreesFor: ((dirPath: string) => ProjectWorktree[] | undefined) | null,
  /** 置顶的路径(用来画图钉)。 */
  pinned: Set<string>,
  /** 用哪份"展开集合"决定递归 —— 置顶区有自己的一份,和树互不影响。 */
  expandedSet: Set<string>,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number, parentIgnored: boolean) => {
    const node = tree.nodes[parent];
    if (!node || node.status !== "loaded") return;
    // 置顶不动这里的顺序:置顶的单独在树顶上开一块列出来,树本身保持
    // 原样 —— 常用目录在原位置的肌肉记忆比"排到最前"更值钱
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      if (keep && !keep.has(path)) continue;
      const isDir = entry.kind === "dir";
      const expanded = isDir && expandedSet.has(path);
      const isRenaming = tree.renaming === path;
      const gitignored = parentIgnored || entry.gitignored;
      const gitStatusCode = gitignored ? null : lookup(path);
      if (isRenaming) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
          gitignored,
          gitStatusCode,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded: expanded,
          depth,
          gitignored,
          gitStatusCode,
          pinned: pinned.has(pinnedKey(path)),
        });
      }
      // 工程挂着 worktree 就直接铺出来(不做展开:临时修 bug 要的就是
      // 一眼看到、一点就切,而且数量通常就一两个)
      if (isDir && worktreesFor) {
        for (const wt of worktreesFor(path) ?? []) {
          rows.push({
            kind: "worktree",
            key: `wt:${wt.path}`,
            path: wt.path,
            name: wt.name,
            branch: wt.branch,
            depth: depth + 1,
          });
        }
      }
      if (isDir && expanded) {
        const child = tree.nodes[path];
        if (tree.pendingCreate?.parentPath === path) {
          rows.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: tree.pendingCreate.kind,
          });
        }
        if (child?.status === "loading") {
          rows.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: "Loading…",
          });
        } else if (child?.status === "error") {
          rows.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walk(path, depth + 1, gitignored);
        }
      }
    }
  };

  walk(rootPath, 0, false);
  return { rows, entryIndexByPath };
}

export const FileExplorer = memo(
  forwardRef<FileExplorerHandle, Props>(function FileExplorer(
    {
      rootPath,
      activeFilePath,
      onOpenFile,
      onPathRenamed,
      onPathDeleted,
      onRevealInTerminal,
      onOpenNewTerminal,
      classifyProjectDir,
      onOpenProject,
      projectGitByPath,
      dirtyPaths,
      activeProjectPath,
      openedProjectPaths,
      projectPtyIds,
      onOpenInSourceControl,
      onOpenGitHistory,
      onAttachToAgent,
      onSetAsRoot,
      headerActions,
      onLinkYunxiaoTask,
      onLinkYunxiaoProject,
      onUnlinkYunxiaoProject,
      linkVersion = 0,
      pathDropTarget,
      gitStatus,
    },
    ref,
  ) {
    const tree = useFileTree(rootPath, { onPathRenamed, onPathDeleted });
    const gitDecorations = usePreferencesStore((s) => s.explorerGitDecorations);
    const { lookup: lookupGitStatus } = useGitStatus(
      rootPath,
      gitDecorations ? gitStatus : null,
      gitDecorations,
    );
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    // 置顶目录(工程上百个,常用的那几个提到最前面)
    const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(() =>
      loadPinnedDirs(),
    );
    useEffect(() => {
      const sync = () => setPinnedPaths(loadPinnedDirs());
      window.addEventListener(PINNED_DIRS_CHANGED_EVENT, sync);
      return () => window.removeEventListener(PINNED_DIRS_CHANGED_EVENT, sync);
    }, []);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const searchRef = useRef<ExplorerSearchHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 头部按钮行放不放得下,得看这一栏实际多宽 —— 侧栏能拖,还能一分为二。
    const headerRef = useRef<HTMLDivElement>(null);
    const [headerWidth, setHeaderWidth] = useState<number | null>(null);
    useEffect(() => {
      const el = headerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([e]) => {
        setHeaderWidth(e.contentRect.width);
      });
      ro.observe(el);
      return () => ro.disconnect();
      // rootPath: 空目录态渲染的是另一棵树,头部这会儿还不存在,拿到根目录才挂得上。
    }, [rootPath]);

    // Windows 的盘符是并列的根,「上一级」永远爬不到隔壁盘 —— 根标签做成
    // 盘符菜单才能切过去。只有能设根目录的左栏需要;别的平台列表为空。
    const canSwitchDrive = IS_WINDOWS && !!onSetAsRoot;
    const [drives, setDrives] = useState<string[]>([]);
    useEffect(() => {
      if (!canSwitchDrive) return;
      native
        .listDrives()
        .then(setDrives)
        .catch(() => {});
    }, [canSwitchDrive]);

    // 产品目录动辄上百个,平时只关心开着 tab 的那几个 —— 这个开关把树收成
    // "只留有打开 tab 的工程 + 它们的父目录"。
    const canFilterOpened = !!openedProjectPaths?.size;
    const [onlyOpened, setOnlyOpened] = useState(
      () => localStorage.getItem("terax.explorer.onlyOpened") === "1",
    );
    useEffect(() => {
      localStorage.setItem("terax.explorer.onlyOpened", onlyOpened ? "1" : "0");
    }, [onlyOpened]);

    // 绑过云效项目的目录,行尾挂云图标。绑定存在 localStorage 里,
    // 必须显式挂 linkVersion 才会在绑完之后重算。
    // biome-ignore lint/correctness/useExhaustiveDependencies: linkVersion 是绑定变更信号
    const linkedDirs = useMemo(
      () => new Set(listProjectLinkDirs()),
      [linkVersion],
    );

    // 右键时的光标位置:目录内搜索的面板贴着它弹,不用把视线甩到屏幕中间
    const [menuAnchor, setMenuAnchor] = useState<{
      x: number;
      y: number;
    } | null>(null);
    // 右键"在此目录内搜索"打开的小弹框(只看这个目录的直接子项 ——
    // 全局递归搜索试过一版,几百条命中把树撑爆,打字掉帧)
    const [dirSearchTarget, setDirSearchTarget] = useState<string | null>(null);

    // 置顶区自己的展开状态:在这儿展开一个目录,不该顺带把树里那份也
    // 掀开(反过来也一样)。数据还是共用 tree.nodes,只是各画各的。
    const [pinnedExpanded, setPinnedExpanded] = useState<Set<string>>(
      new Set(),
    );
    // 当前根目录下的置顶项,单独在树顶上列一块
    const pinnedList = useMemo(() => {
      if (!rootPath) return [] as string[];
      const root = rootPath.replace(/\/+$/, "");
      return [...pinnedPaths]
        .map((p) => pinnedKey(p))
        .filter((p) => p.startsWith(`${root}/`))
        .sort((a, b) =>
          (a.split("/").pop() ?? a).localeCompare(
            b.split("/").pop() ?? b,
            "zh",
          ),
        );
    }, [pinnedPaths, rootPath]);

    // 置顶区的行:复用 buildRows + renderRow,图标/工程样式/分支/状态灯
    // 全部和树里一致。展开状态也和树共用(tree.expanded),两边同步。
    const pinnedRows = useMemo(() => {
      if (!rootPath || pinnedList.length === 0) return [] as Row[];
      const worktreesFor = projectGitByPath
        ? (dir: string) => projectGitByPath[dir]?.worktrees
        : null;
      const out: Row[] = [];
      for (const p of pinnedList) {
        out.push({
          kind: "entry",
          key: `pin:${p}`,
          path: p,
          name: p.split("/").pop() ?? p,
          isDir: true,
          isExpanded: pinnedExpanded.has(p),
          depth: 0,
          gitignored: false,
          gitStatusCode: lookupGitStatus(p),
          pinned: true,
        });
        if (!pinnedExpanded.has(p)) continue;
        const sub = buildRows(
          p,
          tree,
          lookupGitStatus,
          null,
          worktreesFor,
          pinnedPaths,
          pinnedExpanded,
        );
        for (const r of sub.rows) {
          out.push({ ...r, key: `pin:${r.key}`, depth: r.depth + 1 });
        }
      }
      return out;
      // tree 整体每次渲染都换引用,只有下面这几项是 buildRows 真正读的
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      rootPath,
      pinnedList,
      pinnedPaths,
      pinnedExpanded,
      tree.nodes,
      tree.renaming,
      tree.pendingCreate,
      lookupGitStatus,
      projectGitByPath,
    ]);

    const openedKeep = useMemo(() => {
      if (!onlyOpened || !canFilterOpened || !rootPath) return null;
      const root = rootPath.replace(/\/+$/, "");
      const keep = new Set<string>();
      for (const p of openedProjectPaths ?? []) {
        if (p !== root && !p.startsWith(`${root}/`)) continue;
        keep.add(p);
        let d = parentDir(p);
        while (d && d.length > root.length) {
          keep.add(d);
          d = parentDir(d);
        }
      }
      return keep;
    }, [onlyOpened, canFilterOpened, openedProjectPaths, rootPath]);

    const keepPaths = openedKeep;

    // 变更文件浏览器(产品文件区专用,左栏那棵是产品导航树,看改动在那儿
    // 没意义 —— 用"能不能设根目录"区分两棵树)。做成弹框而不是树过滤:
    // 读改动要的是"点一个看一个 diff",树只能给你一堆文件名。
    const canBrowseChanged =
      !onSetAsRoot && !!gitStatus && gitStatus.changedFiles.length > 0;
    const [changedOpen, setChangedOpen] = useState(false);

    // 光过滤还不够:父目录没展开就看不到里面的工程,而展开又是加载子节点的
    // 触发点,所以这里真去展开,而不是画的时候假装展开。
    useEffect(() => {
      if (!openedKeep) return;
      for (const p of openedKeep) {
        if (!openedProjectPaths?.has(p) && !tree.expanded.has(p))
          tree.toggle(p);
      }
    }, [openedKeep, openedProjectPaths, tree.expanded, tree.toggle]);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath)
        return {
          rows: [] as Row[],
          entryIndexByPath: new Map<string, number>(),
        };
      return buildRows(
        rootPath,
        tree,
        lookupGitStatus,
        keepPaths,
        projectGitByPath ? (dir) => projectGitByPath[dir]?.worktrees : null,
        pinnedPaths,
        tree.expanded,
      );
      // `tree` is intentionally omitted: its identity changes every render, but
      // the listed fields are the only inputs buildRows actually reads.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      rootPath,
      tree.nodes,
      tree.expanded,
      tree.renaming,
      tree.pendingCreate,
      lookupGitStatus,
      keepPaths,
      projectGitByPath,
      pinnedPaths,
    ]);

    // Classify visible directories as gradle projects (async, cached). Project
    // dirs get the 安卓工程 treatment: robot icon, no expand, click opens terminal.
    const projectCacheRef = useRef<Map<string, ProjectKind | null>>(new Map());
    const [projectDirs, setProjectDirs] = useState<Map<string, ProjectKind>>(
      new Map(),
    );
    useEffect(() => {
      if (!classifyProjectDir) return;
      // 置顶区那几行也要归类:只在置顶区露过面的工程,不归类就一直画成
      // 普通文件夹,直到它在树里也出现一次才突然变成机器人
      const dirPaths = [...rows, ...pinnedRows].flatMap((r) =>
        r.kind === "entry" && r.isDir ? [r.path] : [],
      );
      let cancelled = false;
      void (async () => {
        for (const p of dirPaths) {
          if (projectCacheRef.current.has(p)) continue;
          const kind = await classifyProjectDir(p);
          projectCacheRef.current.set(p, kind);
          // 工程目录不该展开:若在归类前已被展开,自动收起。
          if (kind && tree.expanded.has(p)) tree.toggle(p);
        }
        if (cancelled) return;
        // 每轮都按缓存重算一遍再比对,不能只在"这轮有新发现"时才 set:
        // 这个 effect 依赖 rows/pinnedRows,加载过程中会重跑好几次,前一轮
        // 刚发现的工程只写进了 ref 就被 cleanup 掐掉,后一轮全命中缓存
        // 又以为"没变化",结果归类结果永远刷不到界面上 —— 表现就是工程
        // 一会儿是机器人一会儿是普通文件夹。
        const next = new Map<string, ProjectKind>();
        for (const [k, v] of projectCacheRef.current) {
          if (v) next.set(k, v);
        }
        setProjectDirs((prev) => {
          if (prev.size === next.size) {
            let same = true;
            for (const [k, v] of next) {
              if (prev.get(k) !== v) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return next;
        });
      })();
      return () => {
        cancelled = true;
      };
    }, [rows, pinnedRows, classifyProjectDir, tree.expanded, tree.toggle]);

    // 工程目录任何时候都不该处于展开态:reveal 到工程内部路径之类的操作
    // 会把它撑开,.git/.worktree 全翻出来。发现就收起,顺带自愈历史状态。
    useEffect(() => {
      for (const p of projectDirs.keys()) {
        if (tree.expanded.has(p)) tree.toggle(p);
      }
    }, [projectDirs, tree.expanded, tree.toggle]);

    const rowActions = useMemo<RowActions>(
      () => ({
        toggle: tree.toggle,
        beginRename: tree.beginRename,
        commitRename: tree.commitRename,
        cancelRename: tree.cancelRename,
      }),
      [tree.toggle, tree.beginRename, tree.commitRename, tree.cancelRename],
    );
    const pinnedRowActions = useMemo<RowActions>(
      () => ({
        ...rowActions,
        toggle: (path: string) => {
          setPinnedExpanded((cur) => {
            const next = new Set(cur);
            if (next.has(path)) next.delete(path);
            else {
              next.add(path);
              // 只拉数据,不动 tree.expanded —— expand() 会把树也展开
              tree.refresh(path);
            }
            return next;
          });
        },
      }),
      [rowActions, tree.refresh],
    );

    const renameInProgress =
      tree.renaming !== null || tree.pendingCreate !== null;

    const [menuTarget, setMenuTarget] = useState<{
      path: string;
      name: string;
      isDir: boolean;
    } | null>(null);
    // 右键"复制到项目目录…"选中的来源工程
    const [copyProjectSource, setCopyProjectSource] = useState<string | null>(
      null,
    );
    const [deleteConfirm, setDeleteConfirm] = useArmedConfirm<true>();
    // Bumped on every right-click so the menu content remounts and the popper
    // re-anchors to the new cursor (floating-ui won't reposition on an anchor
    // change alone, only on scroll/resize).
    const [menuNonce, setMenuNonce] = useState(0);

    const entryPaths = useMemo<string[]>(() => {
      const out: string[] = [];
      for (const row of rows) if (row.kind === "entry") out.push(row.path);
      return out;
    }, [rows]);

    const isDirAt = useCallback(
      (path: string): boolean | undefined => {
        const idx = entryIndexByPath.get(path);
        const row = idx !== undefined ? rows[idx] : undefined;
        return row?.kind === "entry" ? row.isDir : undefined;
      },
      [entryIndexByPath, rows],
    );
    const dnd = useExplorerDnd({
      rootPath: rootPath ?? "",
      isDir: isDirAt,
      onMove: tree.movePath,
      pathDropTarget,
    });

    const fileDrop = useExplorerFileDrop({
      rootPath,
      isDir: isDirAt,
      onCopied: tree.refresh,
    });

    const dropTargetDir = dnd.dropTargetDir ?? fileDrop.externalTargetDir;
    const rootIsDropTarget =
      dropTargetDir != null && dropTargetDir === rootPath;
    useEffect(() => {
      if (!dropTargetDir || dropTargetDir === rootPath) return;
      if (tree.expanded.has(dropTargetDir)) return;
      const id = window.setTimeout(() => tree.expand(dropTargetDir), 700);
      return () => window.clearTimeout(id);
    }, [dropTargetDir, rootPath, tree.expanded, tree.expand]);

    useEffect(() => {
      if (selectedPath && !entryIndexByPath.has(selectedPath)) {
        setSelectedPath(null);
      }
    }, [entryIndexByPath, selectedPath]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      getItemKey: (index) => rows[index]?.key ?? index,
    });

    const scrollEntryIntoView = useCallback(
      (path: string, align: "auto" | "reveal" = "auto") => {
        const index = entryIndexByPath.get(path);
        if (index === undefined) return;
        if (align === "auto") {
          virtualizer.scrollToIndex(index, { align: "auto" });
          return;
        }
        // "reveal": leave the view alone when the row is already on screen —
        // yanking a visible row to the middle is more disorienting than not
        // scrolling at all. Only when it's off screen do we scroll, and then
        // to a bit above centre so there's context below it.
        const el = scrollRef.current;
        if (!el) return;
        const top = index * ROW_HEIGHT;
        const viewTop = el.scrollTop;
        const viewBottom = viewTop + el.clientHeight;
        const margin = ROW_HEIGHT * 2;
        if (
          top >= viewTop + margin &&
          top + ROW_HEIGHT <= viewBottom - margin
        ) {
          return;
        }
        el.scrollTop = Math.max(0, top - el.clientHeight * 0.35);
      },
      [entryIndexByPath, virtualizer],
    );

    const lastSyncedActivePathRef = useRef<string | null>(null);
    useEffect(() => {
      if (
        !activeFilePath ||
        activeFilePath === lastSyncedActivePathRef.current
      ) {
        return;
      }
      if (!entryIndexByPath.has(activeFilePath)) return;
      lastSyncedActivePathRef.current = activeFilePath;
      setSelectedPath(activeFilePath);
      requestAnimationFrame(() =>
        scrollEntryIntoView(activeFilePath, "reveal"),
      );
    }, [activeFilePath, entryIndexByPath, scrollEntryIntoView]);

    // Revealing walks down one level per render: expanding a dir kicks off an
    // async children fetch, so we re-run as `entryIndexByPath` grows until the
    // target finally shows up in the flattened rows.
    const [revealTarget, setRevealTarget] = useState<string | null>(null);
    useEffect(() => {
      if (!revealTarget || !rootPath) return;
      if (!revealTarget.startsWith(`${rootPath}/`)) {
        setRevealTarget(null);
        return;
      }
      if (entryIndexByPath.has(revealTarget)) {
        setSelectedPath(revealTarget);
        const target = revealTarget;
        // Center it — landing flush against the bottom edge (what "auto" gives
        // when scrolling down) buries the hit under the fold.
        requestAnimationFrame(() => scrollEntryIntoView(target, "reveal"));
        setRevealTarget(null);
        return;
      }
      // Expand the shallowest ancestor that isn't open yet.
      const rel = revealTarget.slice(rootPath.length + 1).split("/");
      let dir = rootPath;
      for (let i = 0; i < rel.length - 1; i++) {
        dir = `${dir}/${rel[i]}`;
        if (!tree.expanded.has(dir)) {
          tree.expand(dir);
          return;
        }
      }
    }, [
      revealTarget,
      rootPath,
      entryIndexByPath,
      scrollEntryIntoView,
      tree.expand,
      tree.expanded,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        revealPath: (p: string) => {
          // 刚从置顶区点开的工程:树不用跟着展开(见 skipRevealUntilRef)
          if (performance.now() < skipRevealUntilRef.current) return;
          setRevealTarget(p);
        },
        focus: () => {
          containerRef.current?.focus();
          if (!selectedPath && entryPaths.length > 0) {
            const first = entryPaths[0];
            setSelectedPath(first);
            requestAnimationFrame(() => scrollEntryIntoView(first));
          }
        },
        isFocused: () => {
          const c = containerRef.current;
          if (!c) return false;
          const active = document.activeElement;
          return active instanceof Node && c.contains(active);
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          searchRef.current?.focus();
        },
      }),
      [entryPaths, scrollEntryIntoView, selectedPath],
    );

    useGlobalShortcuts({
      "explorer.search": () => {
        if (searchRef.current?.isFocused()) {
          setIsSearchOpen(false);
          return;
        }
        setIsSearchOpen(true);
        searchRef.current?.focus();
      },
    });

    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-xs text-muted-foreground">
            No current directory
          </div>
        </div>
      );
    }

    const root = tree.nodes[rootPath];
    const pendingAtRoot =
      tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (entryPaths.length === 0) return;

      const currentIdx = selectedPath ? entryPaths.indexOf(selectedPath) : -1;
      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(entryPaths.length - 1, next));
        const path = entryPaths[clamped];
        setSelectedPath(path);
        requestAnimationFrame(() => scrollEntryIntoView(path));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIdx < 0 ? 0 : currentIdx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(currentIdx < 0 ? entryPaths.length - 1 : currentIdx - 1);
          break;
        case "ArrowRight": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) {
            if (!row.isExpanded) tree.toggle(row.path);
            else move(currentIdx + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir && row.isExpanded) {
            tree.toggle(row.path);
          } else {
            const parent = row.path.slice(0, row.path.lastIndexOf("/"));
            if (parent && parent !== rootPath) setSelectedPath(parent);
          }
          break;
        }
        case "Enter": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) tree.toggle(row.path);
          else onOpenFile(row.path);
          break;
        }
      }
    };

    /**
     * 从置顶区打开工程之后,别让树跟着展开定位过去。
     *
     * 置顶本来就是为了不用去树里翻,点一下却把树里同一条路径整个掀开,等于
     * 又翻了一遍。定位那一步在 App 里:androidProjectRoot 一变就调 revealPath,
     * 它并不知道这次点击是从哪儿来的 —— 所以这里点完打一个短时间窗,把紧跟着
     * 的那一次 reveal 挡掉(worktree 行 reveal 的是所属工程,路径对不上,
     * 所以按时间挡而不是按路径)。
     */
    const skipRevealUntilRef = useRef(0);
    const openProjectFromPinned = (path: string) => {
      skipRevealUntilRef.current = performance.now() + 1500;
      onOpenProject?.(path);
    };

    const renderRow = (
      row: Row,
      actions: RowActions = rowActions,
      fromPinned = false,
    ) => {
      const openProject = fromPinned ? openProjectFromPinned : onOpenProject;
      switch (row.kind) {
        case "entry":
        case "rename": {
          return (
            <EntryRow
              path={row.path}
              name={row.name}
              isDir={row.isDir}
              isExpanded={row.kind === "entry" ? row.isExpanded : false}
              depth={row.depth}
              actions={actions}
              renameInProgress={renameInProgress}
              isSelected={selectedPath === row.path}
              isRenaming={row.kind === "rename"}
              isDropTarget={dropTargetDir === row.path}
              onOpenFile={onOpenFile}
              onSelectPath={setSelectedPath}
              gitStatusCode={row.gitStatusCode}
              gitignored={gitDecorations && row.gitignored}
              projectKind={
                row.isDir ? (projectDirs.get(row.path) ?? null) : null
              }
              onOpenProject={openProject}
              isActiveProject={
                !!activeProjectPath && row.path === activeProjectPath
              }
              isOpenedProject={!!openedProjectPaths?.has(row.path)}
              projectPtyIds={projectPtyIds}
              pinned={row.kind === "entry" && row.pinned}
              yunxiaoLinked={row.isDir && linkedDirs.has(row.path)}
              dirty={!row.isDir && !!dirtyPaths?.has(row.path)}
              branch={
                row.isDir
                  ? (projectGitByPath?.[row.path]?.branch ?? null)
                  : null
              }
            />
          );
        }
        case "pending":
          return (
            <PendingRow
              depth={row.depth}
              kind={row.pendingKind}
              onCommit={tree.commitCreate}
              onCancel={tree.cancelCreate}
            />
          );
        case "status":
          return (
            <StatusRow
              depth={row.depth}
              message={row.message}
              tone={row.tone}
            />
          );
        case "worktree":
          return (
            <WorktreeRow
              path={row.path}
              name={row.name}
              branch={row.branch}
              depth={row.depth}
              onOpen={openProject}
              isActive={!!activeProjectPath && row.path === activeProjectPath}
              isOpened={!!openedProjectPaths?.has(row.path)}
              projectPtyIds={projectPtyIds}
            />
          );
      }
    };

    // 顺序即优先级:越靠后越先被收进 ⋯ 菜单。窄到只剩一两格时留下的
    // 应该是每天都点的搜索/筛选/开合,而不是右键菜单里也有的"新建"。
    const actions: ExplorerHeaderAction[] = [];
    actions.push({
      id: "search",
      icon: Search01Icon,
      label: "搜索文件",
      onClick: () => setIsSearchOpen((v) => !v),
    });
    if (canFilterOpened) {
      actions.push({
        id: "filter",
        icon: FilterHorizontalIcon,
        label: onlyOpened ? "显示全部目录" : "只看已打开的工程",
        active: onlyOpened,
        onClick: () => setOnlyOpened((v) => !v),
      });
    }
    if (canBrowseChanged) {
      actions.push({
        id: "changed",
        icon: FileEditIcon,
        text: "diff",
        label: "查看变更文件",
        onClick: () => setChangedOpen(true),
      });
    }
    if (headerActions) actions.push(...headerActions);
    actions.push({
      id: "refresh",
      icon: Refresh01Icon,
      label: "刷新",
      iconSize: 12,
      onClick: () => tree.refresh(rootPath),
    });
    // 只有左栏(能设根目录的那个)才需要"上一级",否则设错了就退不回来。
    if (onSetAsRoot && parentDir(rootPath)) {
      actions.push({
        id: "up",
        icon: ArrowUp01Icon,
        label: "上一级",
        tooltip: `上一级 · ${parentDir(rootPath)}`,
        onClick: () => {
          const up = parentDir(rootPath);
          if (up) onSetAsRoot(up);
        },
      });
    }
    actions.push({
      id: "new-file",
      icon: FileAddIcon,
      label: "新建文件",
      onClick: () => tree.beginCreate(rootPath, "file"),
    });
    actions.push({
      id: "new-dir",
      icon: FolderAddIcon,
      label: "新建文件夹",
      onClick: () => tree.beginCreate(rootPath, "dir"),
    });

    return (
      <div
        ref={containerRef}
        className="flex h-full flex-col outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* overflow-hidden 是保险丝:万一算宽度算漏了,按钮宁可被裁掉,
            也不能溢出到隔壁栏上面 —— 那样看得见却点不着。 */}
        <div
          ref={headerRef}
          className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-border/60 px-2"
        >
          {drives.length > 1 && onSetAsRoot ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title={`${rootPath} · 点击切换盘符`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center truncate rounded text-left text-xs font-medium text-foreground/80 hover:bg-accent/60"
                >
                  <img
                    src={folderIconUrl(basename(rootPath), false)}
                    alt=""
                    height={15}
                    width={15}
                    className="mx-1.5 shrink-0"
                  />
                  <span className="truncate">{basename(rootPath)}</span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={11}
                    strokeWidth={2}
                    className="ml-0.5 shrink-0 text-muted-foreground/70"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-24">
                {drives.map((d) => {
                  const current =
                    rootPath.slice(0, 2).toUpperCase() ===
                    d.slice(0, 2).toUpperCase();
                  return (
                    <DropdownMenuItem
                      key={d}
                      onSelect={() => onSetAsRoot(d)}
                      className={cn(
                        COMPACT_ITEM,
                        current && "font-semibold text-foreground",
                      )}
                    >
                      {d.slice(0, 2)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span
              className="flex min-w-0 flex-1 items-center truncate text-xs font-medium text-foreground/80"
              title={rootPath}
            >
              <img
                src={folderIconUrl(basename(rootPath), false)}
                alt=""
                height={15}
                width={15}
                className="mx-1.5 shrink-0"
              />
              <span className="truncate">{basename(rootPath)}</span>
            </span>
          )}

          <ExplorerHeaderActions actions={actions} width={headerWidth} />
        </div>

        {/* 置顶区:钉住的目录统一列在树顶上,树里的位置不动。点一下 ——
            是工程就直接开/定位终端,不是工程就在下面的树里展开并滚过去。
            平时不出滚动条(置顶就那几个,全铺出来一眼看完);但置顶的目录
            一展开可能是上百个工程,不封顶的话它会把下面的树整个顶出容器,
            结果两边都滚不动。所以给一个 45% 的上限,超了才自己滚。 */}
        {onSetAsRoot && pinnedRows.length > 0 && (
          <div className="max-h-[45%] shrink-0 overflow-y-auto overflow-x-hidden border-b border-border pb-1">
            <div className="sticky top-0 z-20 bg-background px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              置顶
            </div>
            {pinnedRows.map((row) => {
              // 取消置顶走右键:行尾本来就挤着云效图标、分支名、状态灯,
              // 再浮一个 ✕ 上去必然压到别人身上
              const pinRoot =
                row.kind === "entry" && row.depth === 0 ? row : null;
              if (!pinRoot)
                return (
                  <div key={row.key}>
                    {renderRow(row, pinnedRowActions, true)}
                  </div>
                );
              return (
                <ContextMenu key={row.key}>
                  {/* 置顶目录那一行钉在顶上:往下滚的时候还看得见自己在哪个
                      目录里。纯 CSS sticky —— 下一个置顶目录顶上来就自然把
                      前一个推走,不用算滚动位置 */}
                  <ContextMenuTrigger asChild>
                    {/* top-6 = 上面那条"置顶"标题的高度,不然目录行会滑到
                        标题底下被盖住 */}
                    <div className="sticky top-6 z-10 bg-background">
                      {renderRow(row, pinnedRowActions, true)}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className={COMPACT_CONTENT}>
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => {
                        setPinnedDir(pinRoot.path, false);
                        toast.success("已取消置顶", {
                          description: pinRoot.name,
                        });
                      }}
                    >
                      取消置顶
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => setRevealTarget(pinRoot.path)}
                    >
                      在树中定位
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}

        {/* 右键"在此目录内搜索":贴着光标弹,只看这一层 */}
        <DirSearchPopover
          dir={dirSearchTarget}
          anchor={menuAnchor}
          isPinned={(path) => pinnedPaths.has(pinnedKey(path))}
          onTogglePin={(path, pinned) => {
            setPinnedDir(path, pinned);
            toast.success(pinned ? "已置顶" : "已取消置顶", {
              description: path.split("/").pop(),
            });
          }}
          onClose={() => setDirSearchTarget(null)}
          onPick={async (path, isDir) => {
            if (isDir && classifyProjectDir && onOpenProject) {
              const kind = await classifyProjectDir(path);
              if (kind) {
                onOpenProject(path);
                return;
              }
            }
            if (!isDir) {
              onOpenFile(path, true);
              return;
            }
            setRevealTarget(path);
          }}
        />

        <ExplorerSearch
          ref={searchRef}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          open={isSearchOpen}
          onRequestClose={() => setIsSearchOpen(false)}
          onActiveChange={setIsSearchActive}
          onRevealInTerminal={onRevealInTerminal}
          onOpenInSourceControl={onOpenInSourceControl}
          onOpenGitHistory={onOpenGitHistory}
          onAttachToAgent={onAttachToAgent}
        />

        {!isSearchActive ? (
          <ContextMenu
            onOpenChange={(open) => {
              if (!open) setDeleteConfirm(null);
            }}
          >
            <ContextMenuTrigger asChild>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* 置顶那块有标题,这块没有的话两片列表糊在一起分不出来 */}
                {onSetAsRoot && pinnedRows.length > 0 && (
                  <div className="shrink-0 px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {rootPath?.split("/").filter(Boolean).pop() ?? "全部"}
                  </div>
                )}
                <div
                  ref={scrollRef}
                  data-explorer-drop=""
                  className={cn(
                    "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
                    rootIsDropTarget &&
                      "rounded-sm ring-1 ring-inset ring-primary/50",
                  )}
                  onPointerDown={dnd.onPointerDown}
                  onClickCapture={dnd.onClickCapture}
                  onContextMenuCapture={(e) => {
                    const el = (e.target as HTMLElement).closest<HTMLElement>(
                      "[data-fs-path]",
                    );
                    const path = el?.getAttribute("data-fs-path") ?? null;
                    const idx =
                      path != null ? entryIndexByPath.get(path) : undefined;
                    const row = idx !== undefined ? rows[idx] : undefined;
                    setMenuTarget(
                      row && row.kind === "entry"
                        ? { path: row.path, name: row.name, isDir: row.isDir }
                        : null,
                    );
                    setDeleteConfirm(null);
                    setMenuNonce((n) => n + 1);
                    // 记下光标,"在此目录内搜索"的面板要贴着这儿弹
                    setMenuAnchor({ x: e.clientX, y: e.clientY });
                  }}
                >
                  {pendingAtRoot ? (
                    <div
                      className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                      style={{ paddingLeft: 6 }}
                    >
                      <span className="size-3.5 shrink-0" />
                      <img
                        src={
                          pendingAtRoot.kind === "dir"
                            ? folderIconUrl("", false)
                            : fileIconUrl("untitled")
                        }
                        alt=""
                        className="size-4 shrink-0 opacity-70"
                      />
                      <InlineInput
                        initial=""
                        placeholder={
                          pendingAtRoot.kind === "dir"
                            ? "New folder"
                            : "New file"
                        }
                        onCommit={tree.commitCreate}
                        onCancel={tree.cancelCreate}
                      />
                    </div>
                  ) : null}
                  {root?.status === "loading" && (
                    <div className="px-3 py-2 text-[11px] text-muted-foreground">
                      Loading…
                    </div>
                  )}
                  {root?.status === "error" && (
                    <div className="px-3 py-2 text-[11px] text-destructive">
                      {root.message}
                    </div>
                  )}
                  {root?.status === "loaded" ? (
                    <div
                      style={{
                        height: virtualizer.getTotalSize(),
                        position: "relative",
                        width: "100%",
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index];
                        if (!row) return null;
                        return (
                          <div
                            key={virtualRow.key}
                            data-virtual-row-index={virtualRow.index}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: virtualRow.size,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {renderRow(row)}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              key={menuNonce}
              className={COMPACT_CONTENT}
              onCloseAutoFocus={(e) => {
                if (tree.renaming || tree.pendingCreate) e.preventDefault();
              }}
            >
              {menuTarget ? (
                <>
                  {!menuTarget.isDir && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenFile(menuTarget.path, true)}
                    >
                      打开
                    </ContextMenuItem>
                  )}
                  {menuTarget.isDir && onSetAsRoot && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => setDirSearchTarget(menuTarget.path)}
                    >
                      在此目录内搜索…
                    </ContextMenuItem>
                  )}
                  {/* 置顶:同级里排到最前面,常用工程不用每次滚半天 */}
                  {/* 工程本身不给置顶:置顶是给"产品目录"用的入口,工程
                      钉上去只会让那一块越堆越长 */}
                  {menuTarget.isDir &&
                    !projectDirs.has(menuTarget.path) &&
                    (() => {
                      const isPinned = pinnedPaths.has(
                        pinnedKey(menuTarget.path),
                      );
                      return (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => {
                            // 文案按当场读到的真实结果给,不用渲染时算的
                            // isPinned —— 那个只负责菜单显示"置顶/取消置顶"
                            const now = togglePinnedDir(menuTarget.path);
                            toast.success(now ? "已置顶" : "已取消置顶", {
                              description: menuTarget.name,
                            });
                          }}
                        >
                          {isPinned ? "取消置顶" : "置顶"}
                        </ContextMenuItem>
                      );
                    })()}
                  {menuTarget.isDir && onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(menuTarget.path)}
                    >
                      在终端中打开
                    </ContextMenuItem>
                  )}
                  {menuTarget.isDir && onOpenNewTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenNewTerminal(menuTarget.path)}
                    >
                      新开终端
                    </ContextMenuItem>
                  )}
                  {/* 常见流程:从标准版工程复制一份到客户产品目录 */}
                  {menuTarget.isDir && projectDirs.has(menuTarget.path) && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => setCopyProjectSource(menuTarget.path)}
                    >
                      复制到项目目录…
                    </ContextMenuItem>
                  )}
                  {/* 产品目录绑云效项目,底下的工程继承 */}
                  {menuTarget.isDir &&
                    !projectDirs.has(menuTarget.path) &&
                    onLinkYunxiaoProject && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onLinkYunxiaoProject(menuTarget.path)}
                      >
                        {getProjectLink(menuTarget.path)
                          ? "修改云效项目…"
                          : "关联云效项目…"}
                      </ContextMenuItem>
                    )}
                  {menuTarget.isDir &&
                    !projectDirs.has(menuTarget.path) &&
                    onUnlinkYunxiaoProject &&
                    getProjectLink(menuTarget.path) && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onUnlinkYunxiaoProject(menuTarget.path)}
                      >
                        解除云效项目关联
                      </ContextMenuItem>
                    )}
                  {/* 工程目录挂"当前需求",跟着这个仓库走 */}
                  {menuTarget.isDir &&
                    projectDirs.has(menuTarget.path) &&
                    onLinkYunxiaoTask && (
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onLinkYunxiaoTask(menuTarget.path)}
                      >
                        {getTaskLink(menuTarget.path)
                          ? "修改当前云效需求…"
                          : "关联当前云效需求…"}
                      </ContextMenuItem>
                    )}
                  {menuTarget.isDir && onSetAsRoot && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onSetAsRoot(menuTarget.path)}
                    >
                      设为根目录
                    </ContextMenuItem>
                  )}
                  {menuTarget.isDir && onOpenInSourceControl && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenInSourceControl(menuTarget.path)}
                    >
                      在源代码管理中打开
                    </ContextMenuItem>
                  )}
                  {menuTarget.isDir && onOpenGitHistory && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenGitHistory(menuTarget.path)}
                    >
                      查看 Git 历史
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(menuTarget.path)}
                  >
                    在访达中显示
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      tree.beginCreate(
                        menuTarget.isDir
                          ? menuTarget.path
                          : parentOf(menuTarget.path, rootPath),
                        "file",
                      )
                    }
                  >
                    新建文件
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      tree.beginCreate(
                        menuTarget.isDir
                          ? menuTarget.path
                          : parentOf(menuTarget.path, rootPath),
                        "dir",
                      )
                    }
                  >
                    新建文件夹
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(menuTarget.path)}
                  >
                    复制路径
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() =>
                      void copyToClipboard(
                        relativePath(rootPath, menuTarget.path),
                      )
                    }
                  >
                    复制相对路径
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => onAttachToAgent?.(menuTarget.path)}
                  >
                    附加到 AI
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    variant="destructive"
                    onSelect={(e) => {
                      if (deleteConfirm) {
                        void tree.deletePath(menuTarget.path);
                      } else {
                        // Keep the menu open on the first click so the user
                        // can confirm; let it close normally on the second.
                        e.preventDefault();
                        setDeleteConfirm(true);
                      }
                    }}
                  >
                    {deleteConfirm ? "再点一次确认删除" : "删除"}
                  </ContextMenuItem>
                </>
              ) : (
                <>
                  {onRevealInTerminal && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onRevealInTerminal(rootPath)}
                    >
                      在终端中打开
                    </ContextMenuItem>
                  )}
                  {onOpenInSourceControl && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenInSourceControl(rootPath)}
                    >
                      在源代码管理中打开
                    </ContextMenuItem>
                  )}
                  {onOpenGitHistory && (
                    <ContextMenuItem
                      className={COMPACT_ITEM}
                      onSelect={() => onOpenGitHistory(rootPath)}
                    >
                      查看 Git 历史
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void revealInFinder(rootPath)}
                  >
                    在访达中显示
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "file")}
                  >
                    新建文件
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.beginCreate(rootPath, "dir")}
                  >
                    新建文件夹
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => void copyToClipboard(rootPath)}
                  >
                    复制路径
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={COMPACT_ITEM}
                    onSelect={() => tree.refresh(rootPath)}
                  >
                    刷新
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ) : null}

        <CopyProjectDialog
          sourcePath={copyProjectSource}
          rootDir={rootPath}
          onClose={() => setCopyProjectSource(null)}
        />

        <ChangedFilesDialog
          open={changedOpen}
          onOpenChange={setChangedOpen}
          repoRoot={gitStatus?.repoRoot ?? null}
        />

        {dnd.dragLabel ? (
          <div
            ref={dnd.ghostRef}
            className="pointer-events-none fixed left-0 top-0 z-50 flex items-center gap-1.5 rounded-sm border border-border/70 bg-card/95 px-2 py-1 text-[12px] text-foreground shadow-md"
          >
            {dnd.dragLabel}
          </div>
        ) : null}
      </div>
    );
  }),
);
