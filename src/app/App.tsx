import { ProjectWatermark } from "@/app/components/ProjectWatermark";
import { Button } from "@/components/ui/button";
import {
  MAIN_LAYOUT_ID,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { consumeLaunchFiles, getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { usePresence } from "@/lib/usePresence";
import { useZoom } from "@/lib/useZoom";
import { cn, isHtmlPath, isMarkdownPath } from "@/lib/utils";
import { AgentStatusDot } from "@/modules/agent-status/AgentStatusDot";
import {
  AgentNotificationsBridge,
  NotificationBell,
  nextAttentionTarget,
} from "@/modules/agents";
import { cliLeafIds } from "@/modules/agents/lib/cliLeaf";
import { useAgentViewStore } from "@/modules/agents/store/agentViewStore";
import {
  AgentRunBridge,
  AiMiniWindow,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useAiBootstrap,
  useAiLiveBridge,
  useChatStore,
  useSelectionAskAi,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";
import {
  AgentSessionActions,
  BranchChip,
  classifyProjectKind,
  findProjectRoot,
  getProjectLink,
  getTaskLink,
  hasDeviceSupport,
  OpenInToolMenu,
  ProductLinkChip,
  ProjectLinksBar,
  RepoUrlChip,
  setProjectLink,
  setTaskLink,
  supportsSessionActions,
  ToolRail,
  UrlPromptDialog,
  useAndroidRunStore,
  useProjectGitInfo,
  YunxiaoProjectPickerDialog,
} from "@/modules/android-run";
import { REVEAL_RIGHT_PANEL } from "@/modules/browser/webTabsStore";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import { useControlBridge } from "@/modules/control";
import {
  type EditorPaneHandle,
  NewEditorDialog,
  useApplyEditorFontSize,
  useEditorFileSync,
} from "@/modules/editor";
import {
  FileExplorer,
  type FileExplorerHandle,
  type ProjectFilesState,
} from "@/modules/explorer";
import type { GitHistorySearchHandle } from "@/modules/git-history";
import {
  Header,
  type SearchInlineHandle,
  type SearchTarget,
} from "@/modules/header";
import { setLspNavigator } from "@/modules/lsp";
import type { PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type ShortcutHandlers,
  type ShortcutId,
  shouldDisablePaneSwapShortcut,
  useGlobalShortcuts,
} from "@/modules/shortcuts";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useRepositoryTargeting,
  useSourceControlContext,
} from "@/modules/source-control";
import { ChangedFilesDialog } from "@/modules/source-control/ChangedFilesDialog";
import {
  useSpacePersistence,
  useSpaces,
  useSpacesBoot,
} from "@/modules/spaces";
import { StatusBar } from "@/modules/statusbar";
import {
  type CloseTabsPlan,
  TabSwitcherHud,
  useTabSwitcher,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
} from "@/modules/tabs";
import { DEFAULT_SPACE_ID } from "@/modules/tabs/lib/useTabs";
import {
  clearFocusedTerminal,
  disposeSession,
  findLeafCwd,
  hasLeaf,
  leafIds,
  navigateFocusedBlocks,
  type PaneBounds,
  ptyIdForLeaf,
  type TerminalPaneHandle,
  useAgentActivityStore,
  useTerminalFileDrop,
  writeToSession,
} from "@/modules/terminal";
import {
  ThemeProvider,
  useThemeFileEditing,
  WindowVibrancyBridge,
} from "@/modules/theme";
import {
  useWorkspaceEnvStore,
  type WorkspaceEnv,
  workspaceScopeKey,
} from "@/modules/workspace";
import {
  BubbleChatIcon,
  CheckmarkCircle01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchAddon } from "@xterm/addon-search";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  GroupImperativeHandle,
  PanelImperativeHandle,
} from "react-resizable-panels";
import { toast as sonnerToast } from "sonner";
import { CloseDialogs } from "./components/CloseDialogs";
import { FileTabStrip } from "./components/FileTabStrip";
import {
  LeafAgentChat,
  LeafAgentComposer,
  LeafChatDock,
  LeafViewSwitch,
} from "./components/LeafAgentComposer";
import {
  effectiveRightTab,
  RightPanel,
  type RightTab,
  usePanelRoot,
} from "./components/RightPanel";
import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

const RIGHT_TAB_KEY = "terax.rightPanel.tab";

// 目录没了(工程搬家、置顶的旧路径)pty 会悄悄退到家目录:每点一次就多一个
// 家目录终端,和点的那个目录对不上,也去不了重。不开,直接说清楚。
async function dirUsable(path: string): Promise<boolean> {
  try {
    await native.canonicalize(path);
    return true;
  } catch {
    sonnerToast.error("目录不存在,打不开终端", { description: path });
    return false;
  }
}

/** 普通文件夹能不能当"打开的目录":家目录(/Users/me)及以上不算。 */
function isPlainFolderRoot(dir: string): boolean {
  return (
    dir.split(/[\\/]/).filter((p) => p && !/^[A-Za-z]:$/.test(p)).length > 2
  );
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    booted,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newPrivateTab,
    openFileTab,
    newPreviewTab,
    newMarkdownTab,
    newHtmlTab,
    setFileView,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    closeTabs,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    swapActivePaneInDirection,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const searchAddons = useRef<Map<number, SearchAddon>>(new Map());
  const [activeSearchAddon, setActiveSearchAddon] =
    useState<SearchAddon | null>(null);
  const searchInlineRef = useRef<SearchInlineHandle | null>(null);
  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [activeEditorHandle, setActiveEditorHandle] =
    useState<EditorPaneHandle | null>(null);
  const [gitHistoryHandle, setGitHistoryHandle] =
    useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useApplyEditorFontSize();
  const terminalPathDropTarget = useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());

  const clearWorkspaceState = useCallback(() => {
    for (const id of liveLeavesRef.current) disposeSession(id);
    searchAddons.current.clear();
    terminalRefs.current.clear();
    editorRefs.current.clear();
    previewRefs.current.clear();
    setActiveSearchAddon(null);
    setActiveEditorHandle(null);
  }, []);

  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const {
    home,
    launchCwd,
    launchCwdResolved,
    switchWorkspace,
    adoptWorkspaceEnv,
  } = useWorkspaceSwitcher({
    tabsRef,
    workspaceEnv,
    setWorkspaceEnv,
    resetWorkspace,
    clearWorkspaceState,
  });

  const activeSpaceId = useSpaces((s) => s.activeId);
  const spacesHydrated = useSpaces((s) => s.hydrated);
  // Space 即工作区:它的根目录稳定不跟随终端,用作左侧文件树的根,
  // 这样切进产品后左侧仍是完整的项目列表,方便切换。
  const activeSpaceRoot = useSpaces(
    (s) => s.spaces.find((sp) => sp.id === s.activeId)?.root ?? null,
  );
  const setSpaceRoot = useSpaces((s) => s.setRoot);
  const handleSetSpaceRoot = useCallback(
    (path: string) => {
      if (activeSpaceId) setSpaceRoot(activeSpaceId, path);
    },
    [activeSpaceId, setSpaceRoot],
  );
  const activeSpaceIdRef = useRef(activeSpaceId);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
    activeIdRef.current = activeId;
    activeSpaceIdRef.current = activeSpaceId;
  }, [tabs, activeId, activeSpaceId]);
  const sourceControlSpaceId = activeSpaceId ?? DEFAULT_SPACE_ID;

  const handleWorkspaceChange = useCallback(
    async (env: WorkspaceEnv) => {
      const switched = await switchWorkspace(env);
      if (switched && activeSpaceId) {
        useSpaces.getState().setEnv(activeSpaceId, env);
      }
    },
    [switchWorkspace, activeSpaceId],
  );

  useSpacesBoot({
    ready: launchCwdResolved,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  });

  useSpacePersistence({
    tabs,
    activeId,
    activeSpaceId: activeSpaceId ?? DEFAULT_SPACE_ID,
    enabled: spacesHydrated,
  });

  const prevSpaceRef = useRef(activeSpaceId);
  useEffect(() => {
    if (!spacesHydrated || !activeSpaceId) return;
    setActiveSpaceForNewTabs(activeSpaceId);
    const prev = prevSpaceRef.current;
    prevSpaceRef.current = activeSpaceId;
    if (prev === null || prev === activeSpaceId) return;
    const meta = useSpaces
      .getState()
      .spaces.find((s) => s.id === activeSpaceId);
    if (meta) void adoptWorkspaceEnv(meta.env);
    const inSpace = tabsRef.current.filter((t) => t.spaceId === activeSpaceId);
    if (inSpace.length === 0) return;
    // Keep the active tab if it already belongs to the newly active space (a
    // cross-space jump set it explicitly); else fall to the space's last tab.
    if (inSpace.some((t) => t.id === activeId)) return;
    setActiveId(inSpace[inSpace.length - 1].id);
  }, [
    activeSpaceId,
    activeId,
    spacesHydrated,
    setActiveSpaceForNewTabs,
    setActiveId,
    adoptWorkspaceEnv,
  ]);

  // 三栏拖出来的比例记在 localStorage 里,下次启动照着还原
  const mainLayout = useResizableLayout(MAIN_LAYOUT_ID);

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    sidebarWidthStored,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    openSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(explorerRef);

  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteInitialMode, setPaletteInitialMode] = useState<
    "commands" | "content"
  >("commands");
  const openCommandPalette = useCallback(
    (mode: "commands" | "content" = "commands") => {
      setPaletteInitialMode(mode);
      setCommandPaletteOpen(true);
    },
    [],
  );
  const miniOpen = useChatStore((s) => s.mini.open);
  const miniPresence = usePresence(miniOpen, 200);
  const openMini = useChatStore((s) => s.openMini);
  const toggleMini = useChatStore((s) => s.toggleMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  const { hasComposer, keysLoaded } = useAiBootstrap();

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isBlockTab = activeTerminalTab?.blocks === true;
  const isEditorTab = activeTab?.kind === "editor";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  useEditorFileSync({ tabs, tabsRef, editorRefs });
  useThemeFileEditing({ tabsRef, openFileTab });

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  // 当前产品(gradle 工程根),由 android-run 从活动终端 cwd 发现。
  const androidProjectRoot = useAndroidRunStore((s) => s.projectRoot);
  const projectHasDevice = useAndroidRunStore((s) =>
    hasDeviceSupport(s.projectKind),
  );
  // worktree 目录藏在主工程的 .worktree 里,面包屑按原样切段会显示成
  // ".worktree / worktree_xxx",认不出是谁的 —— 展示一律换算成主工程,
  // worktree 名单独作为一段接在后面。
  const worktreeMatch = androidProjectRoot
    ? /^(.*)\/\.worktree\/([^/]+)$/.exec(androidProjectRoot)
    : null;
  const displayProjectRoot = worktreeMatch?.[1] ?? androidProjectRoot;
  const activeWorktreeName = worktreeMatch?.[2] ?? null;
  // 右栏 tab:投屏 / 源码 / 仓库。三个 tab 共用一个宽度,切 tab 不动宽度,
  // 拖到多宽就是多宽(跟着整体布局一起记住)。
  const [rightTab, setRightTab] = useState<RightTab>(() => {
    try {
      const v = localStorage.getItem(RIGHT_TAB_KEY);
      if (v === "device" || v === "source" || v === "repo") return v;
    } catch {}
    return "device";
  });
  const currentRightTab = effectiveRightTab(rightTab, projectHasDevice);
  const devicePanelRef = useRef<PanelImperativeHandle | null>(null);
  const deviceElementRef = useRef<HTMLDivElement | null>(null);
  const workspaceElementRef = useRef<HTMLDivElement | null>(null);
  const [workspaceToolbarHost, setWorkspaceToolbarHost] =
    useState<HTMLDivElement | null>(null);
  const mainGroupRef = useRef<GroupImperativeHandle | null>(null);
  const splitLayoutRef = useRef<Record<string, number> | null>(null);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const [rightTabBarHost, setRightTabBarHost] = useState<HTMLDivElement | null>(
    null,
  );
  const toggleRightPanelExpanded = useCallback(() => {
    const group = mainGroupRef.current;
    if (!group) return;
    const layout = group.getLayout();
    if (layout.workspace === 0) {
      const saved = splitLayoutRef.current;
      const available = 100 - layout.sidebar;
      const workspaceRatio = saved
        ? saved.workspace / (saved.workspace + saved.device)
        : 0.625;
      group.setLayout({
        ...layout,
        workspace: available * workspaceRatio,
        device: available * (1 - workspaceRatio),
      });
    } else {
      splitLayoutRef.current = layout;
      group.setLayout({
        ...layout,
        workspace: 0,
        device: layout.device + layout.workspace,
      });
    }
  }, []);
  const toggleRightPanel = useCallback(() => {
    const group = mainGroupRef.current;
    const layout = group?.getLayout();
    if (group && layout?.workspace === 0) {
      group.setLayout({ ...layout, workspace: layout.device, device: 0 });
      return;
    }
    const p = devicePanelRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, []);
  const selectRightTab = useCallback((tab: RightTab) => {
    setRightTab(tab);
    try {
      localStorage.setItem(RIGHT_TAB_KEY, tab);
    } catch {}
    // 右栏被拖到收起时,点入口要先把它展开
    const p = devicePanelRef.current;
    if (p?.isCollapsed()) p.expand();
  }, []);
  // AI 在内嵌浏览器里操作时右栏要露出来(RightPanel 发这个事件)
  useEffect(() => {
    const reveal = () => {
      const p = devicePanelRef.current;
      if (p?.isCollapsed()) p.expand();
    };
    window.addEventListener(REVEAL_RIGHT_PANEL, reveal);
    return () => window.removeEventListener(REVEAL_RIGHT_PANEL, reveal);
  }, []);

  // 右键工程 → 填"当前云效需求"。跟目录级的云效项目分开:这个跟着仓库走,不继承。
  const [taskDir, setTaskDir] = useState<string | null>(null);
  // 右键产品目录 → 绑云效项目(底下工程继承)
  const [projectLinkDir, setProjectLinkDir] = useState<string | null>(null);
  // 云效需求地址有两个入口(工具栏按钮 / 目录树右键),改完靠这个信号互相同步。
  const [linkVersion, setLinkVersion] = useState(0);
  // 底栏"查看变更文件"弹框(和产品文件区头部那个按钮是同一个东西)
  const [changedFilesOpen, setChangedFilesOpen] = useState(false);
  // 有未保存编辑的文件:git 看不见它们(还没落盘),但树上得标出来,
  // 否则"我明明改了这个文件"和树上一片素白对不上。
  const dirtyFilePaths = useMemo(
    () =>
      new Set(
        tabs.flatMap((t) => (t.kind === "editor" && t.dirty ? [t.path] : [])),
      ),
    [tabs],
  );
  const bumpLinks = useCallback(() => setLinkVersion((n) => n + 1), []);

  // 切 tab 时把左栏定位到该 tab 的工程根,省得每次手动一层层展开找回来。
  const lastRevealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!androidProjectRoot) return;
    if (androidProjectRoot === lastRevealedRef.current) return;
    lastRevealedRef.current = androidProjectRoot;
    // worktree 目录不能直接 reveal:它藏在工程目录里面,展开祖先会把
    // 工程内部(.git/.worktree/…)整个翻出来。树里它有自己的合成子行,
    // 定位到所属的主工程行就够了。
    const wt = /^(.*)\/\.worktree\/[^/]+$/.exec(androidProjectRoot);
    explorerRef.current?.revealPath(wt ? wt[1] : androidProjectRoot);
  }, [androidProjectRoot]);

  // 每个工程各记各的:源码 tab 里开着哪些文件、当前是哪个。切到别的工程
  // 再回来还是原样。
  const [projectFilesByRoot, setProjectFilesByRoot] = useState<
    Record<string, ProjectFilesState>
  >({});

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveSearchAddon(
      activeLeafId !== null
        ? (searchAddons.current.get(activeLeafId) ?? null)
        : null,
    );
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId, activeLeafId]);

  const handleSearchReady = useCallback(
    (leafId: number, addon: SearchAddon) => {
      searchAddons.current.set(leafId, addon);
      if (leafId === activeLeafId) setActiveSearchAddon(addon);
    },
    [activeLeafId],
  );

  const disposeTab = useCallback(
    (id: number) => {
      // Terminal-leaf-keyed maps (terminalRefs/searchAddons) are pruned by
      // the effect below as the pane tree changes; only the tab-id-keyed
      // handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      closeTab(id);
    },
    [closeTab],
  );

  const disposeTabs = useCallback(
    (anchorId: number, plan: CloseTabsPlan) => {
      const closedIds = closeTabs(anchorId, plan);
      for (const id of closedIds) {
        editorRefs.current.delete(id);
        previewRefs.current.delete(id);
      }
    },
    [closeTabs],
  );

  const {
    pendingCloseTab,
    pendingTerminalCloseTab,
    pendingDeleteTabs,
    pendingCloseMany,
    closeManyConfirming,
    handleClose,
    handleCloseTabIds,
    confirmClose,
    cancelClose,
    confirmTerminalClose,
    cancelTerminalClose,
    confirmDeleteClose,
    cancelDeleteClose,
    confirmCloseMany,
    cancelCloseMany,
    handlePathDeleted,
  } = useTabCloseGuards({
    tabs,
    activeId,
    disposeTab,
    disposeTabs,
  });

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(tabsRef);

  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) {
          live.add(id);
          // 窗格名下的命令行终端跟着窗格走,窗格关了一起收
          for (const cli of cliLeafIds(id)) live.add(cli);
        }
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
    for (const k of [...searchAddons.current.keys()])
      if (!live.has(k)) searchAddons.current.delete(k);
  }, [tabs]);

  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeId);
    if (tab?.kind !== "terminal") return;
    const ptyIds = leafIds(tab.paneTree).flatMap((leafId) => {
      const ptyId = ptyIdForLeaf(leafId);
      return ptyId === null ? [] : [ptyId];
    });
    useAgentActivityStore.getState().acknowledgeAttention(ptyIds);
  }, [activeId]);

  // Most-recently-used tab ids, most recent first, pruned to live tabs. Drives
  // the Ctrl+Tab quick switcher so it cycles by recency, not strip order.
  const mruRef = useRef<number[]>([activeId]);
  useEffect(() => {
    mruRef.current = [
      activeId,
      ...mruRef.current.filter((id) => id !== activeId),
    ];
  }, [activeId]);
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.id));
    mruRef.current = mruRef.current.filter((id) => live.has(id));
  }, [tabs]);

  const getSwitcherOrder = useCallback(() => {
    const space = activeSpaceId ?? DEFAULT_SPACE_ID;
    const inSpace = tabsRef.current
      .filter((t) => t.spaceId === space)
      .map((t) => t.id);
    const present = new Set(inSpace);
    const ordered = mruRef.current.filter((id) => present.has(id));
    for (const id of inSpace) if (!ordered.includes(id)) ordered.push(id);
    return [activeId, ...ordered.filter((id) => id !== activeId)];
  }, [activeId, activeSpaceId]);

  const { state: switcherState, step: stepSwitcher } = useTabSwitcher({
    getOrder: getSwitcherOrder,
    onCommit: (id) => {
      if (tabsRef.current.some((t) => t.id === id)) setActiveId(id);
    },
  });

  const cycleSpace = useCallback((delta: 1 | -1) => {
    const { spaces, activeId: sid, setActive } = useSpaces.getState();
    if (spaces.length < 2) return;
    const idx = spaces.findIndex((s) => s.id === sid);
    const next = (idx + delta + spaces.length) % spaces.length;
    setActive(spaces[next].id);
  }, []);

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
  ]);

  const { askPopup, setAskPopup, onAskFromSelection } = useSelectionAskAi({
    captureActiveSelection,
    askFromSelection,
  });
  const askPresence = usePresence(Boolean(askPopup), 120);

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewPrivateTab = useCallback(() => {
    newPrivateTab(inheritedCwdForNewTab());
  }, [newPrivateTab, inheritedCwdForNewTab]);

  const openNewBlockTab = useCallback(() => {
    newBlockTab(inheritedCwdForNewTab());
  }, [newBlockTab, inheritedCwdForNewTab]);

  // 强制新开一个终端(右键「Open New Terminal」),不去重。
  const openNewTerminalAt = useCallback(
    async (path: string) => {
      if (!(await dirUsable(path))) return;
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  // 当前终端里已经跑着的 agent(Claude/Codex…),用来禁掉快捷启动按钮 ——
  // 否则命令会直接打进 agent 的输入框里。
  const agentByPty = useAgentActivityStore((s) => s.agents);
  const activeTerminalAgent = useMemo(() => {
    if (activeLeafId === null) return null;
    const ptyId = ptyIdForLeaf(activeLeafId);
    return ptyId === null ? null : (agentByPty[ptyId] ?? null);
  }, [activeLeafId, agentByPty]);
  // 当前窗格切到了聊天视图:水印和底部整条面包屑栏都收起来,
  // 底下只留输入框(模型、压缩、新会话这些输入框里都有)
  const activeLeafMode = useAgentViewStore((s) =>
    activeLeafId === null ? "terminal" : (s.modes[activeLeafId] ?? "terminal"),
  );
  const activeLeafInChat = isTerminalTab && activeLeafMode === "chat";

  // 右栏占满中间+右边时,当前聊天停到右栏底下:平时只是一条输入框,点一下
  // 展开成右边的聊天记录;点别处(右栏 tab、网页、投屏)又收回一条
  const dockChat =
    rightPanelExpanded && activeLeafInChat && activeLeafId !== null;
  const [dockChatOpen, setDockChatOpen] = useState(false);
  // 聊天框最小化(左上角"−"):输入框整条藏起来,右栏标签栏上留个小圆钮
  const [dockHidden, setDockHidden] = useState(false);
  const dockMinimized = dockChat && dockHidden;
  const restoreDock = useCallback(() => {
    setDockHidden(false);
    // 输入框回来后光标直接进去
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>("[data-chat-dock] textarea")
        ?.focus(),
    );
  }, []);
  // 最小化的小圆钮在右下角(照 Codex)。网页标签页上 app 画的会被原生网页
  // 挡住,那边由 Rust 放进页面里,点了发 web://chat-bubble 回来
  useEffect(() => {
    void invoke("web_chat_bubble", { on: dockMinimized }).catch(() => {});
  }, [dockMinimized]);
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void listen("web://chat-bubble", () => restoreDock()).then((u) => {
      if (alive) off = u;
      else u();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [restoreDock]);
  const dockOpen = dockChat && dockChatOpen;
  useEffect(() => {
    if (!dockOpen) return;
    // 用 click 不用 mousedown:等这次点击在原来的布局上落完再收,
    // 不然按下那一刻布局就变了,松手点到的是别的东西
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest("[data-chat-dock]")) return;
      // 输入框里点开的大图、菜单这类浮层不算"别处"
      if (t?.closest('[role="dialog"], [role="menu"]')) return;
      setDockChatOpen(false);
    };
    // 点到原生网页上,DOM 收不到点击,只能从界面失焦看出来
    const onBlur = () => setDockChatOpen(false);
    window.addEventListener("click", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("click", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [dockOpen]);

  // 投屏批注要知道往哪个聊天发:当前聊天窗格,不在聊天就没有
  const setActiveChatLeaf = useAgentViewStore((s) => s.setActiveChatLeaf);
  useEffect(() => {
    setActiveChatLeaf(activeLeafInChat ? activeLeafId : null);
  }, [activeLeafInChat, activeLeafId, setActiveChatLeaf]);
  // 命令行视图的窗格也能收批注(贴进命令行输入框)
  const setActiveCliLeaf = useAgentViewStore((s) => s.setActiveCliLeaf);
  const activeLeafInCli = isTerminalTab && activeLeafMode === "cli";
  useEffect(() => {
    setActiveCliLeaf(activeLeafInCli ? activeLeafId : null);
  }, [activeLeafInCli, activeLeafId, setActiveCliLeaf]);

  // 往当前终端里发一条斜杠命令。给底栏那几个按钮用 —— 它们只在当前终端确实
  // 跑着 Claude/Codex 时才显示,所以这里不用再判断打给谁。
  //
  // 回车必须跟命令分开发:这两个 TUI 都有粘贴识别 —— 一串字节挤在一起到达时
  // 按粘贴处理,而粘贴里的回车是"换行",不是"提交"。实测 `/clear\r` 一次写进去,
  // Codex 的输入框里就留着 `/clear` 加一个空行,人还得自己再按一下回车。
  // 隔开一拍,回车才会被当成单独按下的 Enter。
  const runInActiveTerminal = useCallback(
    (command: string) => {
      const t =
        activeLeafId !== null ? terminalRefs.current.get(activeLeafId) : null;
      if (!t) return;
      t.write(command);
      t.focus();
      setTimeout(() => t.write("\r"), 120);
    },
    [activeLeafId],
  );

  // 左侧项目树里,已有终端 tab 打开的安卓工程目录用绿字标出来,方便一眼看出
  // 哪些是打开过的。按当前所有终端 tab 的 cwd 反查工程根,tab 关了就退出集合。
  // 同时按工程根汇总各 tab 的 pty id,驱动项目树/面包屑上的 Claude Code 状态灯
  // (working/attention/finished,复用 agentActivity 现成的 OSC 777 检测信号)。
  const projectRootCacheRef = useRef<Map<string, string | null>>(new Map());
  const [openedProjectPaths, setOpenedProjectPaths] = useState<Set<string>>(
    () => new Set(),
  );
  // 已打开工程的 git 概况:树行尾显示当前分支,工程下挂 worktree 子行
  const projectGitByPath = useProjectGitInfo(openedProjectPaths);
  const [projectPtyIds, setProjectPtyIds] = useState<Record<string, number[]>>(
    {},
  );
  // 工程根 → 它的终端 tab。顶部 tab 栏撤了,树上"关闭终端"靠它找要关哪些
  const [projectTabIds, setProjectTabIds] = useState<Record<string, number[]>>(
    {},
  );
  useEffect(() => {
    const terminalTabs = tabs.filter((t) => t.kind === "terminal");
    let cancelled = false;
    void (async () => {
      const roots = new Set<string>();
      const ptyIdsByRoot: Record<string, number[]> = {};
      const tabIdsByRoot: Record<string, number[]> = {};
      for (const t of terminalTabs) {
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd ?? null;
        if (!cwd) continue;
        let root = projectRootCacheRef.current.get(cwd);
        if (root === undefined) {
          // 不在任何工程里的普通文件夹(个人任务、资料目录)也算"打开的",
          // 归到终端所在目录本身:树上能标出来、点回去、参与过滤,和工程
          // 一样。家目录及以上不算,不然没归属的终端全挂到 ~ 头上。
          root =
            (await findProjectRoot(cwd)) ??
            (isPlainFolderRoot(cwd) ? cwd : null);
          projectRootCacheRef.current.set(cwd, root);
        }
        if (!root) continue;
        roots.add(root);
        const ptyIds: number[] = [];
        for (const leaf of leafIds(t.paneTree)) {
          const id = ptyIdForLeaf(leaf);
          if (id !== null) ptyIds.push(id);
        }
        (ptyIdsByRoot[root] ??= []).push(...ptyIds);
        (tabIdsByRoot[root] ??= []).push(t.id);
      }
      if (!cancelled) {
        setOpenedProjectPaths(roots);
        setProjectPtyIds(ptyIdsByRoot);
        setProjectTabIds(tabIdsByRoot);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabs]);

  const closeProjectTerminals = useCallback(
    (root: string) => {
      const ids = projectTabIds[root] ?? [];
      if (ids.length === 0) return;
      if (!handleCloseTabIds(ids)) {
        sonnerToast.info("这是最后一个终端,先打开别的工程再关");
      }
    },
    [projectTabIds, handleCloseTabIds],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      // 顶部 tab 栏撤了,切工程全靠树:目标目录(安卓工程还认它的工程根)
      // 已有终端 tab 就切过去,不重复开。要多开一个走右键"新终端"。
      void (async () => {
        if (!(await dirUsable(path))) return;
        const projectRoot = await findProjectRoot(path);
        const existing = tabsRef.current.find((t) => {
          if (t.kind !== "terminal" || t.spaceId !== activeSpaceIdRef.current)
            return false;
          const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd ?? null;
          return cwd === path || (projectRoot !== null && cwd === projectRoot);
        });
        if (existing) {
          setActiveId(existing.id);
          return;
        }
        void openNewTerminalAt(path);
      })();
    },
    [openNewTerminalAt, setActiveId],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown and html open in their rendered view by default; a per-tab
      // toggle flips them to the raw editor. Other files default to preview
      // (pin=false); explicit actions like context-menu "Open" pass pin=true
      // to persist.
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else if (isHtmlPath(path)) newHtmlTab(path);
      else openFileTab(path, pin ?? false);
    },
    [openFileTab, newMarkdownTab, newHtmlTab],
  );

  const openLaunchFiles = useCallback(
    (paths: string[]) => {
      for (const path of paths) handleOpenFile(path, true);
    },
    [handleOpenFile],
  );

  // Warm start: the backend emits once the window already exists. Attach on
  // mount so an "Open With" that lands mid-restore isn't dropped — the backend
  // also seeds the drain-once state, so the boot drain below is the safety net.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const off = await listen<string[]>("terax:open-file", (e) => {
        openLaunchFiles(e.payload);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openLaunchFiles]);

  // Cold start: files arrive as CLI args (Linux/Windows) or the macOS open-files
  // event, and get_launch_files drains them once. Wait for `booted` — the spaces
  // restore ends in replaceTabs(), which overwrites the whole tab list and would
  // discard a launch tab opened before it, making the file flash open and vanish.
  // Booting first also lands the tab in the restored active space, and lets
  // openFileTab dedupe against a session that already had the file open.
  useEffect(() => {
    if (!booted) return;
    void (async () => {
      openLaunchFiles(await consumeLaunchFiles());
    })();
  }, [booted, openLaunchFiles]);

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  // 终端 cwd → android-run 项目根(工具栏已移到镜像面板,项目发现放这里驱动)。
  const setAndroidProjectRoot = useAndroidRunStore((s) => s.setProjectRoot);
  useEffect(() => {
    // 切到编辑器等非终端 tab 时不清空:点开个文件看看,不该把产品文件区/
    // 投屏/Logcat 整块拆掉(投屏面板一卸载会话就断了)。工程上下文跟着
    // "最后一个终端"走,切回终端自然更新。
    if (activeTerminalLeafCwd === null) return;
    void setAndroidProjectRoot(activeTerminalLeafCwd);
  }, [activeTerminalLeafCwd, setAndroidProjectRoot]);

  // 右栏源码/仓库跟着"最后一个终端"走,切到编辑器 tab 不变
  const [lastTerminalCwd, setLastTerminalCwd] = useState<string | null>(null);
  useEffect(() => {
    if (activeTerminalLeafCwd !== null)
      setLastTerminalCwd(activeTerminalLeafCwd);
  }, [activeTerminalLeafCwd]);
  const rightPanelRoot = usePanelRoot(
    androidProjectRoot,
    lastTerminalCwd,
    home ?? null,
  );

  // 终端窗格可以切成聊天视图(Claude Agent SDK 会话,跑在窗格所在目录),
  // 聊天视图盖在终端上面,输入框挂在窗格底部
  const getLeafCwd = useCallback((leafId: number) => {
    for (const t of tabsRef.current) {
      if (t.kind !== "terminal") continue;
      if (!leafIds(t.paneTree).includes(leafId)) continue;
      return findLeafCwd(t.paneTree, leafId) ?? t.cwd ?? null;
    }
    return null;
  }, []);
  const renderLeafFooter = useCallback(
    (leafId: number) => (
      <LeafAgentComposer leafId={leafId} getCwd={getLeafCwd} />
    ),
    [getLeafCwd],
  );
  // 切到聊天视图的窗格:终端别抢焦点,不然输入框和菜单一打开就被抢走
  const leafModes = useAgentViewStore((s) => s.modes);
  const chatLeaves = useMemo(
    () =>
      new Set(
        Object.entries(leafModes)
          // 聊天、命令行都盖在 shell 上面:shell 不抢焦点
          .filter(([, m]) => m !== "terminal")
          .map(([id]) => Number(id)),
      ),
    [leafModes],
  );
  // 当前窗格的 Claude/Codex、聊天/终端切换摆在工程工具栏最左边;没有工具栏
  // (不在安卓工程里)或不是当前窗格,就还浮在窗格右上角
  const switchLeafId =
    androidProjectRoot && isTerminalTab ? activeLeafId : null;
  const renderLeafOverlay = useCallback(
    (leafId: number, ctx: { visible: boolean; focused: boolean }) => (
      <LeafAgentChat
        leafId={leafId}
        getCwd={getLeafCwd}
        showSwitch={leafId !== switchLeafId}
        visible={ctx.visible}
        focused={ctx.focused}
      />
    ),
    [getLeafCwd, switchLeafId],
  );

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" ||
    activeTab?.kind === "markdown" ||
    activeTab?.kind === "html"
      ? activeTab.path
      : null;
  const isRepositoryContextCurrent = useCallback(
    (spaceId: string, workspaceKey: string) => {
      const currentSpaceId = useSpaces.getState().activeId ?? DEFAULT_SPACE_ID;
      const currentWorkspaceKey = workspaceScopeKey(
        useWorkspaceEnvStore.getState().env,
      );
      return spaceId === currentSpaceId && workspaceKey === currentWorkspaceKey;
    },
    [],
  );
  const openSourceControl = useCallback(() => {
    openSidebarView("source-control");
  }, [openSidebarView]);
  const {
    repositoryTarget: sourceControlRepositoryTarget,
    openInSourceControl: handleOpenRepositoryInSourceControl,
    openGitHistory: handleOpenGitHistoryForPath,
    followActiveContext: handleFollowRepositoryContext,
  } = useRepositoryTargeting({
    spaceId: sourceControlSpaceId,
    workspaceKey: workspaceScopeKey(workspaceEnv),
    isContextCurrent: isRepositoryContextCurrent,
    openSourceControl,
    openCommitHistoryTab,
  });
  const { sourceControl, toggleSourceControl, openGitGraphFromContext } =
    useSourceControlContext({
      activeTab,
      tabs,
      activeTerminalLeafCwd,
      explorerRoot,
      launchCwd,
      launchCwdResolved,
      home,
      sidebarView,
      repositoryTarget: sourceControlRepositoryTarget,
      cycleSidebarView,
      openCommitHistoryTab,
    });
  const explorerGitDecorations = usePreferencesStore(
    (s) => s.explorerGitDecorations,
  );

  // 工程的终端 tab 全关了,才把它在源码 tab 里开着的那几个文件忘掉。
  // 当前这个工程留着不动 —— worktree 之类的根不一定在 openedProjectPaths 里。
  useEffect(() => {
    setProjectFilesByRoot((cur) => {
      const stale = Object.keys(cur).filter(
        (root) => root !== rightPanelRoot && !openedProjectPaths.has(root),
      );
      if (stale.length === 0) return cur;
      const next = { ...cur };
      for (const root of stale) delete next[root];
      return next;
    });
  }, [openedProjectPaths, rightPanelRoot]);

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const livePaneBounds = useCallback((tabId: number): PaneBounds[] => {
    const tab = document.querySelector<HTMLElement>(
      `[data-terminal-tab="${tabId}"]`,
    );
    if (!tab) return [];
    return [...tab.querySelectorAll<HTMLElement>("[data-pane-leaf]")].flatMap(
      (element) => {
        const id = Number(element.dataset.paneLeaf);
        if (!Number.isFinite(id)) return [];
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return [{ id, left, right, top, bottom }];
      },
    );
  }, []);

  const swapActivePane = useCallback(
    (direction: "left" | "right" | "up" | "down") => {
      swapActivePaneInDirection(activeId, direction, livePaneBounds(activeId));
    },
    [activeId, livePaneBounds, swapActivePaneInDirection],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  // Focus an agent's tab, switching to its space first so the header and tab
  // strip don't end up showing a different space than the focused pane.
  const activateAgentTarget = useCallback(
    (tabId: number, leafId: number) => {
      const space = tabsRef.current.find((t) => t.id === tabId)?.spaceId;
      if (space && space !== useSpaces.getState().activeId) {
        useSpaces.getState().setActive(space);
      }
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => openCommandPalette("commands"),
      "commandPalette.content": () => openCommandPalette("content"),
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => stepSwitcher(1),
      "tab.prev": () => stepSwitcher(-1),
      "tab.selectByIndex": (e) =>
        selectByIndex(
          parseInt(e.key, 10) - 1,
          activeSpaceId ?? DEFAULT_SPACE_ID,
        ),
      "space.next": () => cycleSpace(1),
      "space.prev": () => cycleSpace(-1),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.swapLeft": () => swapActivePane("left"),
      "pane.swapRight": () => swapActivePane("right"),
      "pane.swapUp": () => swapActivePane("up"),
      "pane.swapDown": () => swapActivePane("down"),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => navigateFocusedBlocks(-1),
      "blocks.next": () => navigateFocusedBlocks(1),
      "search.focus": () => {
        const editor = editorRefs.current.get(activeId);
        if (editor) editor.openSearch();
        else searchInlineRef.current?.focus();
      },
      "ai.toggle": togglePanelAndFocus,
      "ai.toggleMini": () => {
        if (!hasComposer) {
          void openSettingsWindow("models");
          return;
        }
        toggleMini();
      },
      "ai.askSelection": onAskFromSelection,
      "agent.focusAttention": () => {
        const t = nextAttentionTarget();
        if (t) activateAgentTarget(t.tabId, t.leafId);
      },
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
      "editor.aiComplete": () =>
        editorRefs.current.get(activeId)?.triggerAiComplete(),
      "editor.codeComplete": () =>
        editorRefs.current.get(activeId)?.triggerCodeComplete(),
    }),
    [
      activeId,
      openCommandPalette,
      stepSwitcher,
      cycleSpace,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      activeSpaceId,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      swapActivePane,
      toggleSourceControl,
      hasComposer,
      togglePanelAndFocus,
      toggleMini,
      onAskFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
      activateAgentTarget,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      const terminalPaneCount =
        activeTab?.kind === "terminal"
          ? leafIds(activeTab.paneTree).length
          : null;
      if (shouldDisablePaneSwapShortcut(id, terminalPaneCount)) return true;
      if (
        id === "editor.undo" ||
        id === "editor.redo" ||
        id === "editor.aiComplete" ||
        id === "editor.codeComplete"
      ) {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      // 焦点在右栏源码里时,⌘F 应该是"在这个文件里找",不是全局搜索;
      // ⌘B 那些跳转键也归那里的编辑器。全局这套是 window 捕获 +
      // stopImmediatePropagation,不在这儿让开的话源码 tab 根本收不到键。
      if (id === "search.focus" || id === "explorer.focus") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        if (
          (target as HTMLElement | null)?.closest?.(
            '[data-right-pane="source"]',
          )
        )
          return true;
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) {
        editorRefs.current.set(id, h);
        const pending = pendingEditorNavigation.current.get(id);
        if (pending != null) {
          pendingEditorNavigation.current.delete(id);
          if (pending.line === undefined) h.focus();
          else h.gotoLine(pending.line, { focus: pending.focus });
        }
      } else {
        editorRefs.current.delete(id);
      }
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = activateAgentTarget;

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      // Last pane of the last tab: quit instead of respawning a shell.
      if (leafIds(tab.paneTree).length === 1 && all.length === 1) {
        void getCurrentWindow().close();
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const searchTarget = useMemo<SearchTarget>(() => {
    if (isTerminalTab && activeLeafId !== null && activeSearchAddon)
      return {
        kind: "terminal",
        addon: activeSearchAddon,
        focus: () => terminalRefs.current.get(activeLeafId)?.focus(),
      };
    if (isEditorTab && activeEditorHandle)
      return {
        kind: "editor",
        handle: activeEditorHandle,
        focus: () => activeEditorHandle.focus(),
      };
    if (isGitHistoryTab && gitHistoryHandle)
      return {
        kind: "git-history",
        handle: gitHistoryHandle,
        focus: () => {},
      };
    return null;
  }, [
    isTerminalTab,
    isEditorTab,
    isGitHistoryTab,
    activeLeafId,
    activeSearchAddon,
    activeEditorHandle,
    gitHistoryHandle,
  ]);

  const activeCwd = activeTerminalLeafCwd;

  const handleNewSpace = useCallback(() => {
    const { spaces, create, setActive } = useSpaces.getState();
    const meta = create({
      name: `Space ${spaces.length + 1}`,
      root: activeCwd ?? home ?? null,
      env: workspaceEnv,
    });
    setActiveSpaceForNewTabs(meta.id);
    newTab(activeCwd ?? undefined);
    setActive(meta.id);
    return meta.id;
  }, [activeCwd, home, workspaceEnv, newTab, setActiveSpaceForNewTabs]);

  const commandPaletteItems = useMemo(
    () =>
      commandPaletteOpen
        ? createCommandItems({
            tabs,
            activeId,
            searchTarget,
            explorerRoot,
            home,
            openNewTab,
            openNewBlock: openNewBlockTab,
            openNewPrivate: openNewPrivateTab,
            openNewEditor: () => setNewEditorOpen(true),
            openNewPreview: () => openPreviewTab(""),
            openGitGraph: openGitGraphFromContext,
            toggleSourceControl,
            closeActiveTabOrPane: handleCloseTabOrPane,
            splitPaneRight: () => splitActivePaneInActiveTab("row"),
            splitPaneDown: () => splitActivePaneInActiveTab("col"),
            focusSearch: () => searchInlineRef.current?.focus(),
            focusExplorerSearch: () => explorerRef.current?.focusSearch(),
            toggleSidebar,
            toggleAi: togglePanelAndFocus,
            askAiSelection: askFromSelection,
            openSettings: () => void openSettingsWindow(),
            openKeyboardShortcuts: () => void openSettingsWindow("shortcuts"),
          })
        : [],
    [
      commandPaletteOpen,
      tabs,
      activeId,
      searchTarget,
      explorerRoot,
      home,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      openGitGraphFromContext,
      toggleSourceControl,
      handleCloseTabOrPane,
      splitActivePaneInActiveTab,
      toggleSidebar,
      togglePanelAndFocus,
      askFromSelection,
      activeSpaceId,
      handleNewSpace,
    ],
  );

  const pendingEditorNavigation = useRef<
    Map<number, { line?: number; focus: boolean }>
  >(new Map());
  const openContentHit = useCallback(
    (path: string, line: number) => {
      const id = openFileTab(path, true);
      if (id == null) return;
      const h = editorRefs.current.get(id);
      if (h) h.gotoLine(line);
      else pendingEditorNavigation.current.set(id, { line, focus: true });
    },
    [openFileTab],
  );

  const openControlFile = useCallback(
    ({
      path,
      line,
      focus,
      spaceId,
    }: {
      path: string;
      line?: number;
      focus: boolean;
      spaceId: string;
    }) => {
      if (focus && useSpaces.getState().activeId !== spaceId) {
        useSpaces.getState().setActive(spaceId);
      }
      const id = openFileTab(path, true, {
        spaceId,
        activate: focus,
      });
      const editor = editorRefs.current.get(id);
      if (line !== undefined) {
        if (editor) editor.gotoLine(line, { focus });
        else pendingEditorNavigation.current.set(id, { line, focus });
      } else if (focus) {
        if (editor) editor.focus();
        else pendingEditorNavigation.current.set(id, { focus: true });
      }
      return id;
    },
    [openFileTab],
  );

  useControlBridge({
    ready: spacesHydrated && launchCwdResolved,
    tabsRef,
    activeTabIdRef: activeIdRef,
    activeSpaceIdRef,
    onOpen: openControlFile,
  });

  useEffect(() => {
    setLspNavigator({ openFile: openContentHit });
    return () => setLspNavigator(null);
  }, [openContentHit]);

  const insertHistoryCommand = useMemo(
    () =>
      isTerminalTab && activeLeafId !== null
        ? (cmd: string) => {
            writeToSession(activeLeafId, cmd);
            terminalRefs.current.get(activeLeafId)?.focus();
          }
        : null,
    [isTerminalTab, activeLeafId],
  );

  useAiLiveBridge({
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
    terminalRefs,
  });

  // 当前 Space 里打开的文件/预览/diff:顶部 tab 栏撤了,它们在树上没有
  // 对应的行,单独一条小 tab 栏给它们切换和关闭
  const fileTabs = useMemo(
    () =>
      tabs.filter((t) => t.kind !== "terminal" && t.spaceId === activeSpaceId),
    [tabs, activeSpaceId],
  );

  const workspaceToolbar = androidProjectRoot ? (
    <div
      data-tauri-drag-region
      className={cn(
        "@container flex shrink-0 items-center gap-2 overflow-x-auto px-3 text-[13px]",
        workspaceToolbarHost && !zenMode
          ? "h-full"
          : "border-b border-border py-1.5",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {switchLeafId !== null && (
          <LeafViewSwitch leafId={switchLeafId} getCwd={getLeafCwd} />
        )}
        <AgentStatusDot
          projectRoot={androidProjectRoot}
          projectPtyIds={projectPtyIds}
        />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <OpenInToolMenu projectRoot={androidProjectRoot} />
        <ProjectLinksBar
          projectRoot={androidProjectRoot}
          version={linkVersion}
          onChanged={bumpLinks}
        />
      </span>
    </div>
  ) : null;

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-frame text-foreground">
          {!zenMode && (
            <Header
              onToggleSidebar={toggleSidebar}
              onToggleRightPanel={toggleRightPanel}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              tabBarRef={setRightTabBarHost}
              workspaceToolbarRef={setWorkspaceToolbarHost}
              workspaceElementRef={workspaceElementRef}
              rightPanelElementRef={deviceElementRef}
              rightPanelExpanded={rightPanelExpanded}
              onToggleRightPanelExpanded={toggleRightPanelExpanded}
              spaceSwitcher={null}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1">
            {!zenMode && (
              <ToolRail onOpenSettings={() => void openSettingsWindow()} />
            )}
            <ResizablePanelGroup
              groupRef={mainGroupRef}
              orientation="horizontal"
              className="min-h-0 flex-1"
              defaultLayout={mainLayout.defaultLayout}
              onLayoutChanged={(layout, meta) => {
                // 整体比例交给库存(拖完就记住),侧栏宽度另外还要按 px 存一份:
                // 收起再展开、下次启动都靠它还原
                if (layout.workspace > 0) {
                  mainLayout.onLayoutChanged(layout, meta);
                }
                const width = sidebarRef.current?.getSize().inPixels ?? 0;
                persistSidebarWidth(width, meta.isUserInteraction);
              }}
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : sidebarWidthStored
                      ? `${sidebarWidthRef.current}px`
                      : "20%"
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  persistSidebarCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="h-full min-h-0">
                  <div className="terax-pane terax-pane-sidebar flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1 terax-panel-in">
                      {/* explorer 树常驻挂载(不随 sidebarView 切换重新 key),
                          否则每次切到 git 面板再切回来,虚拟列表滚动位置都会丢。 */}
                      <div
                        className={cn(
                          "flex h-full min-h-0",
                          sidebarView !== "explorer" && "hidden",
                        )}
                      >
                        {/* 左:工作区全部项目树,钉在 Space 根目录(不跟随终端),
                              始终可点别的项目/产品切换。 */}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="min-h-0 flex-1">
                            <FileExplorer
                              ref={explorerRef}
                              rootPath={activeSpaceRoot ?? explorerRoot}
                              hideHeaderActions
                              headerAccessory={
                                <NotificationBell
                                  onActivate={onActivateAgent}
                                  onActivateLocal={onActivateLocalAgent}
                                />
                              }
                              gitStatus={
                                explorerGitDecorations
                                  ? sourceControl.status
                                  : null
                              }
                              dirtyPaths={dirtyFilePaths}
                              activeFilePath={explorerActiveFilePath}
                              onOpenFile={handleOpenFile}
                              onPathRenamed={handlePathRenamed}
                              onPathDeleted={handlePathDeleted}
                              onRevealInTerminal={cdInNewTab}
                              onOpenNewTerminal={openNewTerminalAt}
                              classifyProjectDir={classifyProjectKind}
                              onOpenProject={cdInNewTab}
                              activeProjectPath={
                                androidProjectRoot ??
                                // 普通文件夹:当前终端就开在它上面时也算"当前"
                                (activeCwd && openedProjectPaths.has(activeCwd)
                                  ? activeCwd
                                  : null)
                              }
                              openedProjectPaths={openedProjectPaths}
                              projectPtyIds={projectPtyIds}
                              projectGitByPath={projectGitByPath}
                              onOpenInSourceControl={
                                handleOpenRepositoryInSourceControl
                              }
                              onOpenGitHistory={handleOpenGitHistoryForPath}
                              onAttachToAgent={handleAttachFileToAgent}
                              onSetAsRoot={handleSetSpaceRoot}
                              onCloseProjectTerminals={closeProjectTerminals}
                              onLinkYunxiaoTask={setTaskDir}
                              onLinkYunxiaoProject={setProjectLinkDir}
                              onUnlinkYunxiaoProject={(p) => {
                                const link = getProjectLink(p);
                                setProjectLink(p, null);
                                bumpLinks();
                                sonnerToast.success(
                                  link
                                    ? `已解除关联:${link.name}`
                                    : "已解除关联",
                                );
                              }}
                              linkVersion={linkVersion}
                              pathDropTarget={terminalPathDropTarget}
                            />
                          </div>
                        </div>
                      </div>
                      {/* 云效代码库已经挪到底栏(浮层),这个视图还给本地
                          Git 面板 —— 树里右键"在源码管理中打开"、⌃⇧G 都还是
                          落到这儿。 */}
                      {sidebarView !== "explorer" && (
                        <div className="flex h-full min-h-0 flex-col">
                          {/* 底部那条视图切换撤了,这个面板得自己留一条回文件
                              树的路 —— 否则进来只能靠快捷键出去。 */}
                          <button
                            type="button"
                            onClick={() => openSidebarView("explorer")}
                            className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            ← 文件树
                          </button>
                          <div className="min-h-0 flex-1">
                            <SourceControlPanel
                              open
                              sourceControl={sourceControl}
                              onOpenDiff={openGitDiffTab}
                              onOpenGitGraph={openGitGraphFromContext}
                              onOpenFile={handleOpenFile}
                              onNavigateToPath={cdInNewTab}
                              repositoryTarget={sourceControlRepositoryTarget}
                              onFollowRepositoryContext={
                                handleFollowRepositoryContext
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* 侧栏底部原来那条 Files / 云效代码库 的切换条已经撤了:
                        云效代码库改成底栏浮层,只剩 Files 一个按钮没意义,
                        腾出来的高度还给文件树。 */}
                  </div>
                </div>
              </ResizablePanel>
              {/* 线用 border 画:界面整体缩放到 95%,1px 的背景条只剩 0.95px,有的位置会被
                  整条吞掉;边框至少画一个物理像素 */}
              <ResizableHandle className="w-px shrink-0 cursor-col-resize border-foreground/[0.16] border-l bg-transparent transition-colors duration-[var(--dur-fast)] after:w-3 hover:border-foreground/35" />
              <ResizablePanel
                id="workspace"
                elementRef={workspaceElementRef}
                defaultSize="50%"
                minSize="25%"
                collapsible
                collapsedSize={0}
                onResize={(size) => setRightPanelExpanded(size.inPixels === 0)}
              >
                <div className="h-full min-h-0">
                  <div className="terax-pane flex h-full min-h-0 flex-col">
                    {workspaceToolbarHost && !zenMode
                      ? createPortal(workspaceToolbar, workspaceToolbarHost)
                      : workspaceToolbar}
                    <FileTabStrip
                      tabs={fileTabs}
                      activeId={activeId}
                      onSelect={setActiveId}
                      onClose={(id) => void handleClose(id)}
                    />
                    <div className="relative min-h-0 flex-1">
                      <WorkspaceSurface
                        tabs={tabs}
                        activeId={activeId}
                        activeTab={activeTab}
                        registerTerminalHandle={registerTerminalHandle}
                        onSearchReady={handleSearchReady}
                        onCwd={handleTerminalCwd}
                        onExit={handleLeafExit}
                        onFocusLeaf={handleFocusLeaf}
                        renderLeafFooter={renderLeafFooter}
                        renderLeafOverlay={renderLeafOverlay}
                        focusSuppressed={chatLeaves}
                        registerEditorHandle={registerEditorHandle}
                        onEditorDirtyChange={handleEditorDirty}
                        onEditorCloseTab={disposeTab}
                        registerPreviewHandle={registerPreviewHandle}
                        onPreviewUrlChange={handlePreviewUrl}
                        onAiDiffAccept={(id) => respondToApproval(id, true)}
                        onAiDiffReject={(id) => respondToApproval(id, false)}
                        onOpenCommitFile={openCommitFileDiffTab}
                        onGitHistorySearchHandle={setGitHistoryHandle}
                        onSetFileView={setFileView}
                      />
                      {/* 终端空白处的水印:纯装饰,pointer-events-none 保证不挡
                          选中/点击,也不参与滚动。字号跟着面板宽度走(cqw),
                          写死的话面板一窄工程名就顶出去被裁。 */}
                      {isTerminalTab &&
                        androidProjectRoot &&
                        !activeLeafInChat && (
                          <ProjectWatermark projectRoot={androidProjectRoot} />
                        )}
                    </div>

                    <WorkspaceInputBar
                      isBlockTab={isBlockTab}
                      isTerminalTab={isTerminalTab}
                      activeLeafId={activeLeafId}
                      cwd={activeCwd}
                      home={home}
                      hasComposer={hasComposer}
                      panelOpen={panelOpen}
                      keysLoaded={keysLoaded}
                      onConnect={() => void openSettingsWindow("models")}
                    />
                    {/* 跟顶栏同一套:面包屑不给 min-w-0、内容 nowrap,塞不下时
                        被挤到第二行的是按钮那一组,工程名不会先被截。 */}
                    {androidProjectRoot && !activeLeafInChat && (
                      <div className="@container flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden border-t border-border px-3 py-1 text-[13px]">
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                          {/* 路径这几段包成一整块:断行只发生在"路径 | 分支"
                              之间,不会把 产品 / 工程 / worktree 拆成好几行 */}
                          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                            {/* 面包屑最前面这个文件夹图标就是"产品目录文件"的
                              入口 —— 它本来就代表这个工程所在的目录,比在工具栏
                              上单挂一个按钮好找 */}
                            <button
                              type="button"
                              title="在右栏看源码"
                              onClick={() => selectRightTab("source")}
                              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
                            >
                              <HugeiconsIcon
                                icon={Folder01Icon}
                                size={13}
                                strokeWidth={1.75}
                              />
                            </button>
                            <ProductLinkChip
                              dir={
                                (displayProjectRoot ?? androidProjectRoot)
                                  .split("/")
                                  .slice(0, -1)
                                  .join("/") || androidProjectRoot
                              }
                              label={
                                (displayProjectRoot ?? androidProjectRoot)
                                  .split("/")
                                  .slice(-2, -1)[0] ?? ""
                              }
                              linkVersion={linkVersion}
                              onLink={setProjectLinkDir}
                              className="@max-[360px]:truncate"
                            />
                            <span className="shrink-0 text-muted-foreground/40">
                              /
                            </span>
                            <span className="font-semibold text-emerald-500 @max-[360px]:truncate">
                              {(displayProjectRoot ?? androidProjectRoot)
                                .split("/")
                                .slice(-1)[0] ?? ""}
                            </span>
                            {activeWorktreeName && (
                              <>
                                <span className="shrink-0 text-muted-foreground/40">
                                  /
                                </span>
                                <span className="shrink-0 text-foreground/80">
                                  {activeWorktreeName}
                                </span>
                              </>
                            )}
                          </span>
                          <BranchChip
                            projectRoot={androidProjectRoot}
                            onOpenDiff={openGitDiffTab}
                            onOpenPanel={() => selectRightTab("repo")}
                            /* 不再按 max-w-40 死切:分支名摆不下时整条会掉到
                               第二行,那一行是空的,再截就是白截。真比一整行
                               还长才截(chip 自己有 truncate)。 */
                            className="max-w-full"
                          />
                        </span>
                        {supportsSessionActions(activeTerminalAgent) &&
                          activeTerminalAgent && (
                            <AgentSessionActions
                              agent={activeTerminalAgent}
                              onRun={runInActiveTerminal}
                            />
                          )}
                        {/* 看改动和提交合成一个入口:同一个框里左边选文件、
                            右边看 diff、底下写提交信息,不用在两个浮层间跳 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title={
                            sourceControl.changedCount > 0
                              ? `${sourceControl.changedCount} 个文件有未提交的改动`
                              : "查看改动并提交"
                          }
                          onClick={() => setChangedFilesOpen(true)}
                          className="h-7 shrink-0 gap-1 px-2 text-xs"
                        >
                          <HugeiconsIcon
                            icon={CheckmarkCircle01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          提交
                          {sourceControl.changedCount > 0 && (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 bg-card px-1 text-[9px] font-semibold leading-none tabular-nums text-muted-foreground/95">
                              {sourceControl.changedCount > 99
                                ? "99+"
                                : sourceControl.changedCount}
                            </span>
                          )}
                        </Button>
                        {/* basis-full 换行:git 地址单独占一行,不跟
                            面包屑挤在一起 */}
                        <RepoUrlChip
                          projectRoot={androidProjectRoot}
                          className="basis-full font-mono text-[11px]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-px shrink-0 cursor-col-resize border-foreground/[0.16] border-l bg-transparent transition-colors duration-[var(--dur-fast)] after:w-3 hover:border-foreground/35" />
              <ResizablePanel
                id="device"
                panelRef={devicePanelRef}
                elementRef={deviceElementRef}
                defaultSize="30%"
                minSize="20%"
                collapsible
                collapsedSize={0}
              >
                <div className="h-full min-h-0">
                  <div className="terax-pane relative flex h-full min-h-0 flex-col">
                    {dockMinimized && (
                      <button
                        type="button"
                        title="打开聊天"
                        aria-label="打开聊天"
                        onClick={restoreDock}
                        className="absolute right-4 bottom-4 z-30 flex size-9 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-foreground/85 shadow-lg transition-colors hover:bg-foreground/10"
                      >
                        <HugeiconsIcon
                          icon={BubbleChatIcon}
                          size={17}
                          strokeWidth={1.75}
                        />
                      </button>
                    )}
                    <div className="min-h-0 flex-1">
                      <RightPanel
                        tabBarHost={zenMode ? null : rightTabBarHost}
                        tab={currentRightTab}
                        onTabChange={selectRightTab}
                        hasDevice={projectHasDevice}
                        root={rightPanelRoot}
                        filesState={
                          rightPanelRoot
                            ? projectFilesByRoot[rightPanelRoot]
                            : undefined
                        }
                        onFilesStateChange={(root, next) =>
                          setProjectFilesByRoot((cur) => ({
                            ...cur,
                            [root]: next,
                          }))
                        }
                        onOpenDiff={openGitDiffTab}
                        sourceProps={{
                          gitStatus: explorerGitDecorations
                            ? sourceControl.status
                            : null,
                          dirtyPaths: dirtyFilePaths,
                          onPathRenamed: handlePathRenamed,
                          onPathDeleted: handlePathDeleted,
                          onRevealInTerminal: cdInNewTab,
                          onOpenNewTerminal: openNewTerminalAt,
                          onOpenInSourceControl:
                            handleOpenRepositoryInSourceControl,
                          onOpenGitHistory: handleOpenGitHistoryForPath,
                          onAttachToAgent: handleAttachFileToAgent,
                          pathDropTarget: terminalPathDropTarget,
                        }}
                      />
                    </div>
                    {/* 右栏占满时的聊天框(照 Codex):平时只是右下角一条输入框,
                        点一下从它往上长出聊天记录,浮在页面上;点别处收回。
                        网页是原生视图压在所有界面上面,输入框只能占底下一条窄边,
                        聊天记录浮上去时网页换成定格截图 */}
                    {dockChat && !dockHidden && activeLeafId !== null && (
                      <div className="flex shrink-0 justify-end px-3 pt-1.5 pb-2">
                        {/* biome-ignore lint/a11y/useKeyWithClickEvents: 点输入框展开聊天记录,键盘操作都在输入框里 */}
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: 同上 */}
                        <div
                          data-chat-dock
                          // 一整张卡片(照 Codex):展开时聊天记录接在输入行上面,
                          // 两块拼成一个圆角框
                          className={cn(
                            "relative w-[min(460px,100%)] rounded-2xl border border-border bg-background shadow-xl",
                            dockOpen && "rounded-t-none border-t-border/50",
                          )}
                          // 点完再展开:按下就展开的话,松手那一下可能落在别处,
                          // 被当成"点了外面"立刻又收起,一闪一闪
                          onClick={() => setDockChatOpen(true)}
                        >
                          {dockOpen && (
                            <div
                              role="dialog"
                              aria-label="聊天"
                              className="absolute -right-px bottom-full -left-px flex h-[min(620px,70vh)] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-background shadow-2xl"
                            >
                              <LeafChatDock
                                leafId={activeLeafId}
                                getCwd={getLeafCwd}
                                onCollapse={() => {
                                  setDockChatOpen(false);
                                  setDockHidden(true);
                                }}
                              />
                            </div>
                          )}
                          <LeafAgentComposer
                            leafId={activeLeafId}
                            getCwd={getLeafCwd}
                            compact
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && (
            <StatusBar
              filePath={activeFilePath}
              onWorkspaceChange={handleWorkspaceChange}
              onOpenMini={openMini}
              onOpenAi={togglePanelAndFocus}
              hasComposer={hasComposer}
              privateActive={
                activeTab?.kind === "terminal" && activeTab.private === true
              }
            />
          )}

          <UrlPromptDialog
            value={taskDir ? (getTaskLink(taskDir) ?? "") : null}
            title="当前云效需求"
            description={`贴上手头这条需求/任务的云效地址。只对 ${taskDir?.split("/").pop() ?? ""} 生效,换需求随时改。`}
            onClose={() => setTaskDir(null)}
            onSave={(url) => {
              if (taskDir) setTaskLink(taskDir, url);
              bumpLinks();
            }}
          />

          <YunxiaoProjectPickerDialog
            dir={projectLinkDir}
            current={projectLinkDir ? getProjectLink(projectLinkDir) : null}
            onClose={() => setProjectLinkDir(null)}
            onPick={(link) => {
              if (projectLinkDir) setProjectLink(projectLinkDir, link);
              bumpLinks();
            }}
          />

          <WindowVibrancyBridge />

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          {/* 屏幕正中 + richColors:错误红、成功绿,深色主题下黑底灰字
              看不清。sonner 没有 center 档位,用 top-center 加 45vh 偏移
              顶到屏幕竖直中央。 */}
          <Toaster position="top-center" offset={{ top: "45vh" }} richColors />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          {hasComposer && miniPresence.mounted ? (
            <AiMiniWindow state={miniPresence.state} />
          ) : null}
          {askPresence.mounted ? (
            <SelectionAskAi
              state={askPresence.state}
              x={askPopup?.x ?? 0}
              y={askPopup?.y ?? 0}
              onAsk={onAskFromSelection}
              onDismiss={() => setAskPopup(null)}
            />
          ) : null}

          {switcherState && (
            <TabSwitcherHud tabs={spaceTabs} state={switcherState} />
          )}

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            initialMode={paletteInitialMode}
            commandItems={commandPaletteItems}
            workspaceRoot={explorerRoot}
            onOpenContentHit={openContentHit}
            insertCommand={insertHistoryCommand}
          />

          <ChangedFilesDialog
            open={changedFilesOpen}
            onOpenChange={setChangedFilesOpen}
            repoRoot={sourceControl.status?.repoRoot ?? null}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <CloseDialogs
            tabs={tabs}
            pendingCloseTab={pendingCloseTab}
            onCancelClose={cancelClose}
            onConfirmClose={confirmClose}
            pendingTerminalCloseTab={pendingTerminalCloseTab}
            onCancelTerminalClose={cancelTerminalClose}
            onConfirmTerminalClose={confirmTerminalClose}
            pendingDeleteTabs={pendingDeleteTabs}
            onCancelDeleteClose={cancelDeleteClose}
            onConfirmDeleteClose={confirmDeleteClose}
            pendingCloseMany={pendingCloseMany}
            closeManyConfirming={closeManyConfirming}
            onCancelCloseMany={cancelCloseMany}
            onConfirmCloseMany={confirmCloseMany}
            pendingAppClose={pendingAppClose}
            onCancelAppClose={cancelAppClose}
            onConfirmAppClose={confirmAppClose}
          />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
