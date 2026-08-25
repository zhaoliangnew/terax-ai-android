import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import {
  CopyProjectDialog,
  getProjectLink,
  getTaskLink,
  listProjectLinkDirs,
  type ProjectKind,
} from "@/modules/android-run";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useGlobalShortcuts } from "@/modules/shortcuts";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import {
  ArrowUp01Icon,
  FileAddIcon,
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
import { useExplorerDnd } from "./lib/useExplorerDnd";
import { useExplorerFileDrop } from "./lib/useExplorerFileDrop";
import { useFileTree } from "./lib/useFileTree";
import { useGitStatus } from "./lib/useGitStatus";
import { EntryRow, PendingRow, type RowActions, StatusRow } from "./TreeRow";

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

/** Parent of a root path, or null at the filesystem root (nothing above "/"). */
function parentDir(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  if (i < 0) return null;
  return i === 0 ? "/" : trimmed.slice(0, i);
}

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
  lookup: (path: string) => GitStatusCode | null,
  /** 非空 = 只保留这些路径(以及它们的父目录),其余整棵子树都不画。 */
  keep: Set<string> | null,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number, parentIgnored: boolean) => {
    const node = tree.nodes[parent];
    if (!node || node.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      if (keep && !keep.has(path)) continue;
      const isDir = entry.kind === "dir";
      const expanded = isDir && tree.expanded.has(path);
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
        });
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

    const keepPaths = useMemo(() => {
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

    // 光过滤还不够:父目录没展开就看不到里面的工程,而展开又是加载子节点的
    // 触发点,所以这里真去展开,而不是画的时候假装展开。
    useEffect(() => {
      if (!keepPaths) return;
      for (const p of keepPaths) {
        if (!openedProjectPaths?.has(p) && !tree.expanded.has(p))
          tree.toggle(p);
      }
    }, [keepPaths, openedProjectPaths, tree.expanded, tree.toggle]);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath)
        return {
          rows: [] as Row[],
          entryIndexByPath: new Map<string, number>(),
        };
      return buildRows(rootPath, tree, lookupGitStatus, keepPaths);
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
    ]);

    // Classify visible directories as gradle projects (async, cached). Project
    // dirs get the 安卓工程 treatment: robot icon, no expand, click opens terminal.
    const projectCacheRef = useRef<Map<string, ProjectKind | null>>(new Map());
    const [projectDirs, setProjectDirs] = useState<Map<string, ProjectKind>>(
      new Map(),
    );
    useEffect(() => {
      if (!classifyProjectDir) return;
      const dirPaths = rows.flatMap((r) =>
        r.kind === "entry" && r.isDir ? [r.path] : [],
      );
      let cancelled = false;
      void (async () => {
        let changed = false;
        for (const p of dirPaths) {
          if (projectCacheRef.current.has(p)) continue;
          const kind = await classifyProjectDir(p);
          projectCacheRef.current.set(p, kind);
          if (kind) {
            changed = true;
            // 工程目录不该展开:若在归类前已被展开,自动收起。
            if (tree.expanded.has(p)) tree.toggle(p);
          }
        }
        if (!cancelled && changed) {
          const next = new Map<string, ProjectKind>();
          for (const [k, v] of projectCacheRef.current) {
            if (v) next.set(k, v);
          }
          setProjectDirs(next);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [rows, classifyProjectDir, tree.expanded, tree.toggle]);

    const rowActions = useMemo<RowActions>(
      () => ({
        toggle: tree.toggle,
        beginRename: tree.beginRename,
        commitRename: tree.commitRename,
        cancelRename: tree.cancelRename,
      }),
      [tree.toggle, tree.beginRename, tree.commitRename, tree.cancelRename],
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
    const [deleteConfirm, setDeleteConfirm] = useState(false);
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
        revealPath: (p: string) => setRevealTarget(p),
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

    const renderRow = (row: Row) => {
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
              actions={rowActions}
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
              onOpenProject={onOpenProject}
              isActiveProject={
                !!activeProjectPath && row.path === activeProjectPath
              }
              isOpenedProject={!!openedProjectPaths?.has(row.path)}
              projectPtyIds={projectPtyIds}
              yunxiaoLinked={row.isDir && linkedDirs.has(row.path)}
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

          <ExplorerHeaderActions actions={actions} width={headerWidth} />
        </div>

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
              if (!open) setDeleteConfirm(false);
            }}
          >
            <ContextMenuTrigger asChild>
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
                  setDeleteConfirm(false);
                  setMenuNonce((n) => n + 1);
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
                        pendingAtRoot.kind === "dir" ? "New folder" : "New file"
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
