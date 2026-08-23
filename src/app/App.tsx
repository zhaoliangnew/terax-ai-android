import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { consumeLaunchFiles, getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { usePresence } from "@/lib/usePresence";
import { useZoom } from "@/lib/useZoom";
import { cn, isMarkdownPath } from "@/lib/utils";
import { AgentStatusDot } from "@/modules/agent-status/AgentStatusDot";
import {
  type AgentLaunchRequest,
  AgentNotificationsBridge,
  findAgentLauncher,
  nextAttentionTarget,
  validateAgentLaunchCommand,
} from "@/modules/agents";
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
  AgentQuickLaunch,
  classifyProjectKind,
  findProjectRoot,
  getTaskLink,
  isSupportedProductDir,
  OpenInToolMenu,
  ProjectLinksBar,
  type QuickAgentId,
  setTaskLink,
  UrlPromptDialog,
  useAndroidRunStore,
  YunxiaoLinkDialog,
} from "@/modules/android-run";
import { CommandPalette, createCommandItems } from "@/modules/command-palette";
import { useControlBridge } from "@/modules/control";
import {
  type EditorPaneHandle,
  NewEditorDialog,
  useApplyEditorFontSize,
  useEditorFileSync,
} from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
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
  SidebarRail,
  useSidebarPanel,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  useRepositoryTargeting,
  useSourceControlContext,
} from "@/modules/source-control";
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
  whenSessionReady,
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
import { Folder01Icon, SidebarRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchAddon } from "@xterm/addon-search";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { CloseDialogs } from "./components/CloseDialogs";

const DevicePanel = lazy(() => import("@/modules/android-run/DevicePanel"));

import {
  TOGGLE_BLOCK_INPUT_EVENT,
  WorkspaceInputBar,
} from "./components/WorkspaceInputBar";
import { WorkspaceSurface } from "./components/WorkspaceSurface";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useTabCloseGuards } from "./hooks/useTabCloseGuards";
import { useWorkspaceSwitcher } from "./hooks/useWorkspaceSwitcher";

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    allocId,
    booted,
    replaceTabs,
    reorderTabByGap,
    markBooted,
    setActiveSpaceForNewTabs,
    newTab,
    newBlockTab,
    newAgentTab,
    newAgentGroupTab,
    newPrivateTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    setMarkdownView,
    setOverrideLanguage,
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

  const spaceTabs = useMemo(
    () => tabs.filter((t) => t.spaceId === (activeSpaceId ?? DEFAULT_SPACE_ID)),
    [tabs, activeSpaceId],
  );

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    persistSidebarView,
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
  // 只有真正的 Android/Flutter 工程才值得多开一块产品文件区,普通 gradle
  // 工程(没有 AndroidManifest,也不是 Flutter)不算,避免误判。
  const [productDirSupported, setProductDirSupported] = useState(false);
  useEffect(() => {
    if (!androidProjectRoot) {
      setProductDirSupported(false);
      return;
    }
    let cancelled = false;
    void isSupportedProductDir(androidProjectRoot).then((ok) => {
      if (!cancelled) setProductDirSupported(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [androidProjectRoot]);
  // 右侧设备栏只对安卓/Flutter 工程有意义。普通目录(文档、资料夹)里它只会
  // 显示"没有在线设备",白占半屏 —— 折叠掉而不是卸载,这样投屏会话还活着,
  // 切回工程 tab 立刻就在,不用重连。
  const devicePanelRef = useRef<PanelImperativeHandle | null>(null);
  useEffect(() => {
    const p = devicePanelRef.current;
    if (!p) return;
    const collapsed = p.getSize().asPercentage <= 0;
    if (androidProjectRoot) {
      if (collapsed) p.resize("44%");
    } else if (!collapsed) {
      p.collapse();
    }
  }, [androidProjectRoot]);

  // 右键目录 → 关联云效项目(云效项目对应产品线目录,不是单个仓库)。
  const [yunxiaoDir, setYunxiaoDir] = useState<string | null>(null);
  // 右键工程 → 填"当前云效需求"。跟目录级的云效项目分开:这个跟着仓库走,不继承。
  const [taskDir, setTaskDir] = useState<string | null>(null);
  // 云效需求地址有两个入口(工具栏按钮 / 目录树右键),改完靠这个信号互相同步。
  const [linkVersion, setLinkVersion] = useState(0);
  const bumpLinks = useCallback(() => setLinkVersion((n) => n + 1), []);

  // 切 tab 时把左栏定位到该 tab 的工程根,省得每次手动一层层展开找回来。
  const lastRevealedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!androidProjectRoot) return;
    if (androidProjectRoot === lastRevealedRef.current) return;
    lastRevealedRef.current = androidProjectRoot;
    explorerRef.current?.revealPath(androidProjectRoot);
  }, [androidProjectRoot]);

  // 产品文件区默认收起 —— 大多数时候左栏的项目树就够用了,展开一次后
  // 记住选择(localStorage,纯本机偏好)。
  const [productPaneOpen, setProductPaneOpen] = useState(
    () => localStorage.getItem("terax.productPaneOpen") === "1",
  );
  useEffect(() => {
    localStorage.setItem("terax.productPaneOpen", productPaneOpen ? "1" : "0");
  }, [productPaneOpen]);
  // 收起产品文件区时把侧栏宽度一起收回去 —— 否则那半边只是空着,左边的树
  // 白白铺开一片空白;展开时再还回来。
  const toggleProductPane = useCallback(() => {
    setProductPaneOpen((open) => {
      const next = !open;
      const p = sidebarRef.current;
      const width = p?.getSize().inPixels ?? 0;
      if (p && width > 0) {
        const target = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, Math.round(next ? width * 2 : width / 2)),
        );
        p.resize(`${target}px`);
        // 点开合也是用户主动调宽度,得记住 —— 侧栏默认只在手动拖动时才持久化,
        // 不显式存的话下次启动会还原成展开时的宽度,产品区明明收着,左边树
        // 却铺开一片空白。
        persistSidebarWidth(target, true);
      }
      return next;
    });
  }, [sidebarRef, persistSidebarWidth]);
  // 进产品后在右侧多加一块产品文件区(左侧钉住 Space 全部项目树)。
  const showProductPane =
    androidProjectRoot !== null &&
    androidProjectRoot !== (activeSpaceRoot ?? explorerRoot) &&
    productDirSupported;

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
    handleCloseTabsToRight,
    handleCloseOtherTabs,
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
        for (const id of leafIds(t.paneTree)) live.add(id);
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

  const launchAgentGroup = useCallback(
    (request: AgentLaunchRequest) => {
      const command = validateAgentLaunchCommand(request.command);
      if (!command.ok) return;
      const launcher = findAgentLauncher(request.agent);
      const title =
        request.instances === 1
          ? launcher.label
          : `${launcher.label} × ${request.instances}`;
      const { leafIds: agentLeafIds } = newAgentGroupTab(
        inheritedCwdForNewTab(),
        title,
        request.instances,
      );
      const hooksReady = launcher.supportsHooks
        ? invoke("agent_enable_hooks", {
            agent: request.agent,
          }).catch((error) => {
            console.warn(
              `[terax] could not enable ${request.agent} notifications:`,
              error,
            );
          })
        : Promise.resolve();

      for (const leafId of agentLeafIds) {
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, `${command.command}\r`)) {
            console.error(
              `[terax] agent terminal ${leafId} closed before launch`,
            );
          }
        })();
      }
    },
    [inheritedCwdForNewTab, newAgentGroupTab],
  );

  // 强制新开一个终端(右键「Open New Terminal」),不去重。
  const openNewTerminalAt = useCallback(
    (path: string) => {
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

  // 一键起 agent:优先直接用当前终端(你多半已经在这个工程的终端里了,再开一个
  // 纯属添乱);只有当前 tab 不是终端时才新开一个。
  const openAgentTerminal = useCallback(
    (path: string, command: string, agent: QuickAgentId) => {
      const line = `cd ${quoteShellArg(path)} && ${command}\r`;
      // Install the OSC 777 notification hook first, same as the built-in
      // agent launcher does — without it the agent only ever emits `started`
      // and the status dot stays stuck on 🟡 working forever.
      const hooksReady = invoke("agent_enable_hooks", { agent }).catch(
        (error) => {
          console.warn(
            `[terax] could not enable ${agent} notifications:`,
            error,
          );
        },
      );
      const current =
        activeLeafId !== null ? terminalRefs.current.get(activeLeafId) : null;
      if (current) {
        void hooksReady.then(() => {
          current.write(line);
          current.focus();
        });
        return;
      }
      const tabId = newTab(path);
      void (async () => {
        await hooksReady;
        setTimeout(() => {
          const tab = tabsRef.current.find((x) => x.id === tabId);
          if (!tab || tab.kind !== "terminal") return;
          const t = terminalRefs.current.get(tab.activeLeafId);
          if (!t) return;
          t.write(line);
          t.focus();
        }, 80);
      })();
    },
    [newTab, activeLeafId],
  );

  // 左侧项目树里,已有终端 tab 打开的安卓工程目录用绿字标出来,方便一眼看出
  // 哪些是打开过的。按当前所有终端 tab 的 cwd 反查工程根,tab 关了就退出集合。
  // 同时按工程根汇总各 tab 的 pty id,驱动项目树/面包屑上的 Claude Code 状态灯
  // (working/attention/finished,复用 agentActivity 现成的 OSC 777 检测信号)。
  const projectRootCacheRef = useRef<Map<string, string | null>>(new Map());
  const [openedProjectPaths, setOpenedProjectPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [projectPtyIds, setProjectPtyIds] = useState<Record<string, number[]>>(
    {},
  );
  useEffect(() => {
    const terminalTabs = tabs.filter((t) => t.kind === "terminal");
    let cancelled = false;
    void (async () => {
      const roots = new Set<string>();
      const ptyIdsByRoot: Record<string, number[]> = {};
      for (const t of terminalTabs) {
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd ?? null;
        if (!cwd) continue;
        let root = projectRootCacheRef.current.get(cwd);
        if (root === undefined) {
          root = await findProjectRoot(cwd);
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
      }
      if (!cancelled) {
        setOpenedProjectPaths(roots);
        setProjectPtyIds(ptyIdsByRoot);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabs]);

  const cdInNewTab = useCallback(
    (path: string) => {
      // 安卓工程目录去重:目标(或其上层工程根)已有终端 tab 就切过去,不重复开;
      // 非安卓目录保持原样,可以开多个。
      void (async () => {
        const projectRoot = await findProjectRoot(path);
        if (projectRoot) {
          const existing = tabsRef.current.find((t) => {
            if (t.kind !== "terminal" || t.spaceId !== activeSpaceIdRef.current)
              return false;
            const cwd =
              findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd ?? null;
            return cwd === path || cwd === projectRoot;
          });
          if (existing) {
            setActiveId(existing.id);
            return;
          }
        }
        openNewTerminalAt(path);
      })();
    },
    [openNewTerminalAt, setActiveId],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Markdown opens in its rendered view by default; a per-tab toggle flips
      // it to the raw editor. Other files default to preview (pin=false);
      // explicit actions like context-menu "Open" pass pin=true to persist.
      if (isMarkdownPath(path)) newMarkdownTab(path);
      else openFileTab(path, pin ?? false);
    },
    [openFileTab, newMarkdownTab],
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
    void setAndroidProjectRoot(activeTerminalLeafCwd);
  }, [activeTerminalLeafCwd, setAndroidProjectRoot]);

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
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
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

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
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

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-frame text-foreground">
          {!zenMode && (
            <Header
              tabs={spaceTabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewBlock={openNewBlockTab}
              onNewPrivate={openNewPrivateTab}
              onNewPreview={() => openPreviewTab("")}
              onNewEditor={() => setNewEditorOpen(true)}
              onNewGitGraph={openGitGraphFromContext}
              onLaunchAgents={launchAgentGroup}
              onClose={handleClose}
              onCloseTabsToRight={handleCloseTabsToRight}
              onCloseOtherTabs={handleCloseOtherTabs}
              onPin={pinTab}
              onRename={handleRenameTab}
              onReorder={reorderTabByGap}
              onToggleSidebar={toggleSidebar}
              onOpenCommandPalette={() => openCommandPalette("commands")}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
              spaceSwitcher={null}
              searchTarget={searchTarget}
              searchRef={searchInlineRef}
              onOverrideLanguage={setOverrideLanguage}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
              onLayoutChanged={(_, { isUserInteraction }) => {
                const width = sidebarRef.current?.getSize().inPixels ?? 0;
                persistSidebarWidth(width, isUserInteraction);
              }}
            >
              <ResizablePanel
                id="sidebar"
                panelRef={sidebarRef}
                defaultSize={
                  initialSidebarCollapsed
                    ? "0px"
                    : `${sidebarWidthRef.current}px`
                }
                minSize={`${SIDEBAR_MIN_WIDTH}px`}
                maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                collapsible
                collapsedSize={0}
                onResize={(size) => {
                  persistSidebarCollapsed(size.inPixels <= 0);
                }}
              >
                <div className="h-full min-h-0 pl-2 pr-0.5">
                  <div className="terax-pane flex h-full min-h-0 flex-col">
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
                              gitStatus={
                                explorerGitDecorations
                                  ? sourceControl.status
                                  : null
                              }
                              activeFilePath={explorerActiveFilePath}
                              onOpenFile={handleOpenFile}
                              onPathRenamed={handlePathRenamed}
                              onPathDeleted={handlePathDeleted}
                              onRevealInTerminal={cdInNewTab}
                              onOpenNewTerminal={openNewTerminalAt}
                              classifyProjectDir={classifyProjectKind}
                              onOpenProject={cdInNewTab}
                              activeProjectPath={androidProjectRoot}
                              openedProjectPaths={openedProjectPaths}
                              projectPtyIds={projectPtyIds}
                              onOpenInSourceControl={
                                handleOpenRepositoryInSourceControl
                              }
                              onOpenGitHistory={handleOpenGitHistoryForPath}
                              onAttachToAgent={handleAttachFileToAgent}
                              onSetAsRoot={handleSetSpaceRoot}
                              onLinkYunxiao={setYunxiaoDir}
                              onLinkYunxiaoTask={setTaskDir}
                              headerActions={
                                showProductPane && androidProjectRoot
                                  ? [
                                      {
                                        id: "product-pane",
                                        icon: SidebarRightIcon,
                                        label: productPaneOpen
                                          ? "收起产品目录文件"
                                          : "展开产品目录文件",
                                        active: productPaneOpen,
                                        onClick: toggleProductPane,
                                      },
                                    ]
                                  : undefined
                              }
                              pathDropTarget={terminalPathDropTarget}
                            />
                          </div>
                        </div>
                        {showProductPane &&
                          androidProjectRoot &&
                          productPaneOpen && (
                            <div className="flex min-w-0 flex-1 flex-col border-l border-border/60">
                              <div className="min-h-0 flex-1">
                                <FileExplorer
                                  rootPath={androidProjectRoot}
                                  gitStatus={
                                    explorerGitDecorations
                                      ? sourceControl.status
                                      : null
                                  }
                                  activeFilePath={explorerActiveFilePath}
                                  onOpenFile={handleOpenFile}
                                  onPathRenamed={handlePathRenamed}
                                  onPathDeleted={handlePathDeleted}
                                  onRevealInTerminal={cdInNewTab}
                                  onOpenNewTerminal={openNewTerminalAt}
                                  onOpenInSourceControl={
                                    handleOpenRepositoryInSourceControl
                                  }
                                  onOpenGitHistory={handleOpenGitHistoryForPath}
                                  onAttachToAgent={handleAttachFileToAgent}
                                  pathDropTarget={terminalPathDropTarget}
                                />
                              </div>
                            </div>
                          )}
                      </div>
                      {sidebarView !== "explorer" && (
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
                      )}
                    </div>
                    <SidebarRail
                      activeView={sidebarView}
                      onSelectView={persistSidebarView}
                      changedCount={sourceControl.changedCount}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-1 cursor-col-resize rounded-full bg-border/45 transition-colors duration-[var(--dur-fast)] after:w-5 hover:bg-border" />
              <ResizablePanel id="workspace" defaultSize="34%" minSize="25%">
                <div className="h-full min-h-0 px-0.5">
                  <div className="terax-pane flex h-full min-h-0 flex-col">
                    {/* 换行交给 flex-wrap 自己判断:面包屑不给 min-w-0、内容
                        nowrap,它的最小宽度就是完整的产品/工程名,塞不下时被挤
                        走的是按钮那一组(换到第二行),名字始终完整。定死一个
                        断点的话名字长短一变就又不准了。
                        @container 只留给最后一档:第二行也摆不开就丢按钮文案。 */}
                    {androidProjectRoot && (
                      <div className="@container flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden border-b border-border px-3 py-1.5 text-[15px]">
                        <span className="flex flex-1 items-center gap-2 whitespace-nowrap @max-[360px]:min-w-0">
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={14}
                            strokeWidth={1.75}
                            className="shrink-0 text-muted-foreground/70"
                          />
                          <span className="text-muted-foreground/80 @max-[360px]:truncate">
                            {androidProjectRoot.split("/").slice(-2, -1)[0] ??
                              ""}
                          </span>
                          <span className="shrink-0 text-muted-foreground/40">
                            /
                          </span>
                          <span className="font-semibold text-emerald-500 @max-[360px]:truncate">
                            {androidProjectRoot.split("/").slice(-1)[0] ?? ""}
                          </span>
                          <AgentStatusDot
                            projectRoot={androidProjectRoot}
                            projectPtyIds={projectPtyIds}
                          />
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <AgentQuickLaunch
                            projectRoot={androidProjectRoot}
                            busyAgent={activeTerminalAgent}
                            onLaunch={openAgentTerminal}
                          />
                          <OpenInToolMenu projectRoot={androidProjectRoot} />
                          <ProjectLinksBar
                            projectRoot={androidProjectRoot}
                            version={linkVersion}
                            onChanged={bumpLinks}
                          />
                        </span>
                      </div>
                    )}
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
                        registerEditorHandle={registerEditorHandle}
                        onEditorDirtyChange={handleEditorDirty}
                        onEditorCloseTab={disposeTab}
                        registerPreviewHandle={registerPreviewHandle}
                        onPreviewUrlChange={handlePreviewUrl}
                        onAiDiffAccept={(id) => respondToApproval(id, true)}
                        onAiDiffReject={(id) => respondToApproval(id, false)}
                        onOpenCommitFile={openCommitFileDiffTab}
                        onGitHistorySearchHandle={setGitHistoryHandle}
                        onSetMarkdownView={setMarkdownView}
                      />
                      {/* 终端空白处的水印:纯装饰,pointer-events-none 保证不挡
                          选中/点击,也不参与滚动。字号跟着面板宽度走(cqw),
                          写死的话面板一窄工程名就顶出去被裁。 */}
                      {isTerminalTab && androidProjectRoot && (
                        <div
                          aria-hidden
                          className="@container pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center gap-2 px-6 opacity-[0.12]"
                        >
                          <span className="max-w-full truncate text-[clamp(12px,4.5cqw,34px)] leading-none tracking-[0.18em]">
                            {androidProjectRoot.split("/").slice(-2, -1)[0] ??
                              ""}
                          </span>
                          <span className="max-w-full truncate text-[clamp(16px,7cqw,52px)] leading-none font-bold tracking-[0.06em]">
                            {androidProjectRoot.split("/").slice(-1)[0] ?? ""}
                          </span>
                        </div>
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
                    {androidProjectRoot && (
                      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-[14px]">
                        <HugeiconsIcon
                          icon={Folder01Icon}
                          size={13}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground/70"
                        />
                        <span className="truncate text-muted-foreground/80">
                          {androidProjectRoot.split("/").slice(-2, -1)[0] ?? ""}
                        </span>
                        <span className="text-muted-foreground/40">/</span>
                        <span className="truncate font-semibold text-emerald-500">
                          {androidProjectRoot.split("/").slice(-1)[0] ?? ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle className="w-1 cursor-col-resize rounded-full bg-border/45 transition-colors duration-[var(--dur-fast)] after:w-5 hover:bg-border" />
              <ResizablePanel
                id="device"
                panelRef={devicePanelRef}
                defaultSize="44%"
                minSize="20%"
                collapsible
                collapsedSize={0}
              >
                <div className="h-full min-h-0 pl-0.5 pr-2">
                  <div className="terax-pane flex h-full min-h-0 flex-col">
                    <Suspense fallback={null}>
                      <DevicePanel />
                    </Suspense>
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

          <YunxiaoLinkDialog
            dir={yunxiaoDir}
            onClose={() => setYunxiaoDir(null)}
          />

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

          <WindowVibrancyBridge />

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />

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
