import { cn } from "@/lib/utils";
import { saveAgent, savedAgent } from "@/modules/agents/lib/chatPrefs";
import {
  cliLeafId,
  isSafeSessionId,
  resumeInCliInput,
  resumeLaunchCommand,
} from "@/modules/agents/lib/cliLeaf";
import { findAgentLauncher } from "@/modules/agents/lib/launcher";
import {
  type AgentViewMode,
  type CliAgent,
  useAgentViewStore,
} from "@/modules/agents/store/agentViewStore";
import {
  AGENT_NAMES,
  CHAT_APIS,
  type ChatAgent,
  chatSessionNow,
  useChatSession,
} from "@/modules/agents/store/chatProviders";
import { native } from "@/modules/ai/lib/native";
import { AGENT_QUICK_COMMANDS } from "@/modules/android-run/AgentQuickLaunch";
import {
  OPEN_REPO_TAB,
  pendingRepoCommit,
} from "@/modules/browser/webTabsStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  CHAT_AGENTS,
  coerceVisibleChatAgents,
  firstVisibleChatAgent,
  firstVisiblePaneAgent,
  isChatCapable,
  PANE_AGENTS,
  type PaneAgent,
} from "@/modules/settings/store";
import {
  ptyIdForLeaf,
  TerminalPane,
  useAgentActivityStore,
} from "@/modules/terminal";
import {
  leafHasForegroundJob,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import { MinusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

const AgentChatView = lazy(() =>
  import("@/modules/agents/components/AgentChatView").then((m) => ({
    default: m.AgentChatView,
  })),
);
const AgentComposer = lazy(() =>
  import("@/modules/agents/components/AgentComposer").then((m) => ({
    default: m.AgentComposer,
  })),
);

type Props = {
  leafId: number;
  getCwd: (leafId: number) => string | null;
};

/** 终端里正在跑的是窗格切换里的哪个 AI(别的 agent / 没在跑就是 null)。 */
function asPaneAgent(name: string | null | undefined): PaneAgent | null {
  return PANE_AGENTS.find((a) => a === name) ?? null;
}

function runningAgent(leafId: number): PaneAgent | null {
  const pty = ptyIdForLeaf(leafId);
  return pty === null
    ? null
    : asPaneAgent(useAgentActivityStore.getState().agents[pty]);
}

const paneAgentName = (a: PaneAgent) =>
  a === "antigravity" ? "Antigravity" : AGENT_NAMES[a];

type AgentInputs = {
  picked: PaneAgent | null | undefined;
  running: PaneAgent | null;
  cwd: string | null;
  fallback: ChatAgent;
  visible: readonly PaneAgent[];
};

/**
 * 窗格用谁:这个窗格手动选过的 > 终端里正在跑的 > 这个目录上次用的 > 设置里的默认,
 * 设置里关掉的 AI 一律跳过。
 */
function chooseAgent(i: AgentInputs): PaneAgent {
  return firstVisiblePaneAgent(
    [i.picked, i.running, savedAgent(i.cwd), i.fallback],
    i.visible,
  );
}

/** 同上,只在能聊天的里挑:聊天视图和输入框用。 */
function chooseChatAgent(i: AgentInputs): ChatAgent {
  return firstVisibleChatAgent(
    [i.picked, i.running, savedAgent(i.cwd), i.fallback],
    i.visible,
  );
}

function agentInputs(leafId: number, cwd: string | null): AgentInputs {
  const prefs = usePreferencesStore.getState();
  return {
    picked: useAgentViewStore.getState().agents[leafId],
    running: runningAgent(leafId),
    cwd,
    fallback: prefs.defaultChatAgent,
    visible: prefs.visibleChatAgents,
  };
}

function resolveAgent(leafId: number, cwd: string | null): PaneAgent {
  return chooseAgent(agentInputs(leafId, cwd));
}

function resolveChatAgent(leafId: number, cwd: string | null): ChatAgent {
  return chooseChatAgent(agentInputs(leafId, cwd));
}

/** 给界面用的那几样输入(跟着终端里的 agent 变)。 */
function useAgentInputs(leafId: number, cwd: string | null): AgentInputs {
  const picked = useAgentViewStore((s) => s.agents[leafId]);
  const running = useAgentActivityStore((s) => {
    const pty = ptyIdForLeaf(leafId);
    return pty === null ? null : asPaneAgent(s.agents[pty]);
  });
  const fallback = usePreferencesStore((s) => s.defaultChatAgent);
  const visible = usePreferencesStore((s) => s.visibleChatAgents);
  return { picked, running, cwd, fallback, visible };
}

function useLeafAgent(leafId: number, cwd: string | null): PaneAgent {
  return chooseAgent(useAgentInputs(leafId, cwd));
}

function useLeafChatAgent(leafId: number, cwd: string | null): ChatAgent {
  return chooseChatAgent(useAgentInputs(leafId, cwd));
}

function statusText(
  agentName: string,
  status: string | undefined,
  error: string | null,
) {
  if (status === "starting") return `正在启动 ${agentName}…`;
  if (status === "error") return `启动失败:${error ?? "未知错误"}`;
  if (status === "closed") return "会话已结束,发一条消息会开一个新会话";
  return null;
}

/**
 * 把窗格切到聊天。目录在点的那一刻现场读:终端刚 cd 完、组件还没重新渲染时,
 * 渲染时拿到的 cwd 还是空的。
 */
function openLeafChat(
  leafId: number,
  getCwd: (leafId: number) => string | null,
  pick?: ChatAgent,
) {
  const dir = getCwd(leafId);
  if (!dir) {
    toast.error("这个终端还不知道在哪个目录,先在里面 cd 一下");
    return;
  }
  const who = pick ?? resolveChatAgent(leafId, dir);
  const store = useAgentViewStore.getState();
  store.setAgent(leafId, who);
  saveAgent(dir, who);
  CHAT_APIS[who].ensure(leafId, dir);
  store.setMode(leafId, "chat");
}

/** 两个一组的小切换(Claude | Codex、聊天 | 终端):点一下就切。 */
function Segmented<T extends string>({
  options,
  value,
  onPick,
  title,
}: {
  options: { value: T; label: string; disabled?: string }[];
  value: T;
  onPick: (v: T) => void;
  title?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={title}
      title={title}
      className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-background/90 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={!!o.disabled}
          title={o.disabled}
          onClick={() => onPick(o.value)}
          className={cn(
            "h-6 cursor-pointer rounded-md px-2.5 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-35",
            o.value === value
              ? "bg-foreground/15 text-foreground"
              : "text-muted-foreground enabled:hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function agentOptions(
  visible: readonly CliAgent[],
): { value: CliAgent; label: string }[] {
  return coerceVisibleChatAgents(visible).map((a) => ({
    value: a,
    label: paneAgentName(a),
  }));
}

/** 在命令行终端里把 AI 跑起来(先装好通知钩子,状态灯要靠它)。 */
function launchCli(id: number, agent: CliAgent, resume: string | null) {
  const hooks = findAgentLauncher(agent).supportsHooks
    ? invoke("agent_enable_hooks", { agent }).catch(() => {})
    : Promise.resolve();
  const base = AGENT_QUICK_COMMANDS[agent];
  const cmd = resume ? resumeLaunchCommand(agent, base, resume) : base;
  void hooks
    .then(() => whenSessionReady(id))
    .then(() => writeToSession(id, `${cmd}\r`));
}

/**
 * 聊天里有对话的话,切命令行时把这个会话交过去:聊天这边先停掉(两边同时
 * 往一个会话里写会乱),返回要在命令行里接着的会话 id。
 */
function handOffChat(leafId: number, agent: CliAgent): string | null {
  if (!isChatCapable(agent)) return null;
  const chat = chatSessionNow(agent, leafId);
  const id = chat?.sessionId;
  if (!chat || !id || !isSafeSessionId(id)) return null;
  // 还没说过话的会话没存盘,命令行接不上
  if (!chat.items.some((i) => i.kind === "user")) return null;
  if (chat.working) {
    toast.info("聊天这一轮还没结束,命令行里先不接这个会话");
    return null;
  }
  CHAT_APIS[agent].suspend(leafId);
  return id;
}

/**
 * 切到命令行:这个 AI 的命令行终端没开过就开一个并把 AI 跑起来;开过但 AI
 * 已经退出(停在 shell 提示符),再点一下就重新跑起来。
 */
function openLeafCli(
  leafId: number,
  getCwd: (leafId: number) => string | null,
  agent: CliAgent,
) {
  const store = useAgentViewStore.getState();
  const id = cliLeafId(leafId, agent);
  if (!(store.clis[leafId] ?? []).includes(agent)) {
    if (!getCwd(leafId)) {
      toast.error("这个终端还不知道在哪个目录,先在里面 cd 一下");
      return;
    }
    store.openCli(leafId, agent);
    launchCli(id, agent, handOffChat(leafId, agent));
  } else {
    const resume = handOffChat(leafId, agent);
    void leafHasForegroundJob(id).then((busy) => {
      if (!busy) {
        launchCli(id, agent, resume);
        return;
      }
      if (!resume) return;
      const input = resumeInCliInput(agent, resume);
      if (input) void writeToSession(id, input);
      else
        toast.info(
          `${paneAgentName(agent)} 命令行已经在跑别的会话,退出后再点"命令行"就接上聊天`,
        );
    });
  }
  store.setMode(leafId, "cli");
}

/**
 * 窗格的 AI 选择(Claude | Codex | Antigravity | Qoder)和视图切换(聊天 | 命令行 | 终端)。
 * 当前窗格的摆在工程工具栏最左边,没有工具栏(或不是当前窗格)时浮在窗格右上角。
 */
export function LeafViewSwitch({ leafId, getCwd }: Props) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const setMode = useAgentViewStore((s) => s.setMode);
  const agent = useLeafAgent(leafId, getCwd(leafId));
  const visible = usePreferencesStore((s) => s.visibleChatAgents);
  const agents = agentOptions(visible);

  const openTerminal = () => setMode(leafId, "terminal");
  const show = (view: AgentViewMode, who: CliAgent) => {
    if (view === "chat" && isChatCapable(who))
      openLeafChat(leafId, getCwd, who);
    else if (view !== "terminal") openLeafCli(leafId, getCwd, who);
    else openTerminal();
  };
  // 换 AI:在聊天/命令行里就直接换过去(没有聊天的 AI 落到命令行);
  // 在终端里只记下来,之后点聊天/命令行时用它
  const pickAgent = (who: CliAgent) => {
    useAgentViewStore.getState().setAgent(leafId, who);
    saveAgent(getCwd(leafId), who);
    if (mode !== "terminal") show(mode, who);
  };
  const noChat = isChatCapable(agent)
    ? undefined
    : `${paneAgentName(agent)} 还没接聊天,先用命令行`;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {agents.length > 1 && (
        <Segmented
          title="用哪个 AI"
          options={agents}
          value={agent}
          onPick={pickAgent}
        />
      )}
      <Segmented
        options={[
          { value: "chat", label: "聊天", disabled: noChat },
          { value: "cli", label: "命令行" },
          { value: "terminal", label: "终端" },
        ]}
        value={mode}
        onPick={(v) => show(v, agent)}
      />
    </div>
  );
}

/**
 * 设置里关掉了某个 AI:这个窗格里它的聊天停掉(会话记着,重新打开后还能接上);
 * 窗格选的正好是它就换成还开着的,在聊天/命令行里的跟着切过去。
 */
function useDisabledAgentGuard(
  leafId: number,
  getCwd: (leafId: number) => string | null,
) {
  const visible = usePreferencesStore((s) => s.visibleChatAgents);
  const picked = useAgentViewStore((s) => s.agents[leafId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: getCwd 现场读,不跟着它重跑
  useEffect(() => {
    const shown = coerceVisibleChatAgents(visible);
    for (const a of CHAT_AGENTS) {
      if (!shown.includes(a) && chatSessionNow(a, leafId)) {
        CHAT_APIS[a].suspend(leafId);
      }
    }
    if (!picked || shown.includes(picked)) return;
    const dir = getCwd(leafId);
    const mode = useAgentViewStore.getState().modes[leafId] ?? "terminal";
    if (mode === "chat" && dir) {
      openLeafChat(leafId, getCwd, resolveChatAgent(leafId, dir));
      return;
    }
    const next = resolveAgent(leafId, dir);
    useAgentViewStore.getState().setAgent(leafId, next);
    saveAgent(dir, next);
    if (mode === "cli" && dir) openLeafCli(leafId, getCwd, next);
  }, [leafId, visible, picked]);
}

/**
 * 窗格里各个 AI 的命令行终端:开过的都挂着(切走只藏起来,里面的 AI 接着跑),
 * 只露出当前选中的那个。
 */
function LeafCliTerminals({
  leafId,
  getCwd,
  visible,
  focused,
}: Props & { visible: boolean; focused: boolean }) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const opened = useAgentViewStore((s) => s.clis[leafId]);
  const agent = useLeafAgent(leafId, getCwd(leafId));
  if (!opened?.length) return null;
  const on = mode === "cli";
  return (
    <div
      className={cn(
        "absolute inset-0 z-10",
        on ? "bg-background" : "pointer-events-none invisible",
      )}
    >
      {opened.map((a) => (
        <div key={a} className="absolute inset-0">
          <TerminalPane
            leafId={cliLeafId(leafId, a)}
            visible={visible && on && a === agent}
            focused={focused && on && a === agent}
            initialCwd={getCwd(leafId) ?? undefined}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * 盖在终端窗格上面的聊天视图。聊天是一个独立的会话(Claude Agent SDK 或
 * codex app-server),在这个窗格的目录里跑;终端一直在下面,切回去就是原样。
 * `showSwitch`:Claude/Codex、聊天/终端切换浮在窗格右上角(当前窗格的切换
 * 在工程工具栏上时不用再画)。
 */
export function LeafAgentChat({
  leafId,
  getCwd,
  showSwitch = true,
  visible = true,
  focused = false,
}: Props & { showSwitch?: boolean; visible?: boolean; focused?: boolean }) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const addQuote = useAgentViewStore((s) => s.addQuote);
  const agent = useLeafChatAgent(leafId, getCwd(leafId));
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);
  useDisabledAgentGuard(leafId, getCwd);

  const modeSet = useAgentViewStore((s) => leafId in s.modes);

  // 窗格刚打开、还没切过:默认进聊天(接着这个目录上次的会话,历史会铺上)。
  // 终端的目录要等 shell 起来报过来,这个组件那时不一定会重新渲染,所以隔一会儿
  // 看一眼,拿到目录就切过去收手;一直拿不到就留在终端。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在窗格刚出现、还没选过视图时跑
  useEffect(() => {
    if (modeSet) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (useAgentViewStore.getState().modes[leafId] !== undefined) {
        clearInterval(timer);
        return;
      }
      const dir = getCwd(leafId);
      if (!dir && tries < 40) return;
      clearInterval(timer);
      if (!dir) return;
      // 这个目录上次用的是只有命令行的 AI:直接开它的命令行
      const who = resolveAgent(leafId, dir);
      if (isChatCapable(who)) openLeafChat(leafId, getCwd, who);
      else openLeafCli(leafId, getCwd, who);
    }, 250);
    return () => clearInterval(timer);
  }, [modeSet]);

  return (
    <>
      {mode === "chat" && (
        <Suspense fallback={null}>
          <AgentChatView
            cwd={getCwd(leafId)}
            items={session?.items ?? []}
            agentName={AGENT_NAMES[agent]}
            working={session?.working ?? false}
            compacting={session?.compacting ?? false}
            compaction={session?.compaction ?? null}
            statusText={statusText(
              AGENT_NAMES[agent],
              session?.status,
              session?.error ?? null,
            )}
            permissions={session?.permissions ?? []}
            onPermission={(id, allow, always, input, message) =>
              api.respond(leafId, id, allow, always, input, message)
            }
            onQuote={(text) => addQuote(leafId, text)}
            onReply={(text) => api.send(leafId, text, [])}
          />
        </Suspense>
      )}
      <LeafCliTerminals
        leafId={leafId}
        getCwd={getCwd}
        visible={visible}
        focused={focused}
      />
      {showSwitch && (
        <div className="absolute top-2 right-3 z-20">
          <LeafViewSwitch leafId={leafId} getCwd={getCwd} />
        </div>
      )}
    </>
  );
}

/**
 * 窗格目录当前的分支(worktree 里再带上 worktree 名)和未提交文件数,
 * 给输入框上方显示。
 * 终端里随时可能切分支、cd 走,每隔几秒重新看一眼。
 */
function useLeafBranch(
  leafId: number,
  getCwd: (leafId: number) => string | null,
  on: boolean,
) {
  const [branch, setBranch] = useState<{
    name: string;
    worktree: string | null;
    changed: number;
  } | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const read = () => {
      const dir = getCwd(leafId);
      if (!dir) return;
      native
        .gitResolveRepo(dir)
        .then(async (r) => {
          if (!alive) return;
          if (!r) {
            setBranch(null);
            return;
          }
          const name = r.isDetached ? `${r.branch}(游离)` : r.branch;
          // worktree 放在主工程的 .worktree/<名字> 下
          const worktree =
            /\/\.worktree\/([^/]+)$/.exec(r.repoRoot)?.[1] ?? null;
          // 读不到改动数就当 0,不该连分支一起不显示
          const changed = await native
            .gitStatus(r.repoRoot)
            .then((st) => st.changedFiles.length)
            .catch(() => 0);
          if (!alive) return;
          setBranch((cur) =>
            cur?.name === name &&
            cur.worktree === worktree &&
            cur.changed === changed
              ? cur
              : { name, worktree, changed },
          );
        })
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, 4000);
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [leafId, getCwd, on]);
  return branch;
}

/** 聊天模式下窗格底部的输入框;终端模式下不出现。 */
export function LeafAgentComposer({
  leafId,
  getCwd,
  compact = false,
}: Props & { compact?: boolean }) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const quote = useAgentViewStore((s) => s.quotes[leafId] ?? null);
  const injection = useAgentViewStore((s) => s.injections[leafId] ?? null);
  const agent = useLeafChatAgent(leafId, getCwd(leafId));
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);
  const branch = useLeafBranch(leafId, getCwd, mode === "chat");
  // 按钮上要显示模型名:会话还没报当前模型时,先把模型列表拉回来,
  // 拿默认那项的名字顶上(不然只能写个"Claude")
  const needModels =
    mode === "chat" && !!session && session.models.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: api 跟着 agent 变,agent 已在依赖里
  useEffect(() => {
    if (needModels) api.requestModels(leafId);
  }, [needModels, leafId, agent, session?.status]);
  if (mode !== "chat") return null;

  const cwd = () => getCwd(leafId);
  return (
    <Suspense fallback={null}>
      <AgentComposer
        agent={agent}
        working={session?.working ?? false}
        quote={quote}
        injection={injection}
        onSend={(text, attachments) => {
          const dir = cwd();
          // 会话结束了再发:接着同一个会话聊,不是新开
          if (
            dir &&
            (!session ||
              session.status === "closed" ||
              session.status === "error")
          ) {
            api.ensure(leafId, dir);
          }
          api.send(leafId, text, attachments);
        }}
        onStop={() => api.interrupt(leafId)}
        permissionMode={session?.permissionMode ?? null}
        onSetMode={(m) => api.setMode(leafId, m)}
        model={session?.model ?? null}
        models={session?.models ?? []}
        // 模型列表整个会话里不变:拿到过就不再拉,免得菜单打开时内容刷新、跳一下
        onOpenModels={() => {
          if (!session?.models.length) api.requestModels(leafId);
        }}
        onSetModel={(m) => api.setModel(leafId, m)}
        effort={session?.effort ?? null}
        ultracode={session?.ultracode ?? false}
        appliedEffort={session?.appliedEffort ?? null}
        ultracodeAvailable={session?.ultracodeAvailable ?? true}
        onSetUltracode={(on) => api.setUltracode?.(leafId, on)}
        serviceTier={session?.serviceTier ?? null}
        onSetEffort={(e) => api.setEffort?.(leafId, e)}
        onSetServiceTier={(t) => api.setServiceTier?.(leafId, t)}
        usage={session?.usage}
        branch={branch}
        onOpenRepo={(commit) => {
          if (commit) pendingRepoCommit.at = Date.now();
          window.dispatchEvent(new Event(OPEN_REPO_TAB));
        }}
        context={session?.context}
        compact={compact}
        onOpenUsage={() => api.requestUsage(leafId)}
        commands={session?.commands}
        onOpenCommands={() => api.requestCommands(leafId)}
        compacting={session?.compacting ?? false}
        onCompact={() => api.compact(leafId)}
        onNewChat={() => {
          const dir = cwd();
          if (dir) api.restart(leafId, dir);
        }}
      />
    </Suspense>
  );
}

/**
 * 右栏占满时停在右边的聊天记录(点底下输入框展开的那块):顶上一条标题,
 * 右上角"—"收回去只剩输入框。
 */
export function LeafChatDock({
  leafId,
  getCwd,
  onCollapse,
}: Props & { onCollapse: () => void }) {
  const addQuote = useAgentViewStore((s) => s.addQuote);
  const agent = useLeafChatAgent(leafId, getCwd(leafId));
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);
  return (
    <>
      {/* 照 Codex:"−"在左上角,点了最小化成右栏标签栏上的小圆钮 */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 pr-3 pl-2">
        <button
          type="button"
          title="最小化"
          onClick={onCollapse}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={14} strokeWidth={2} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
          {AGENT_NAMES[agent]} 聊天
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={null}>
          <AgentChatView
            cwd={getCwd(leafId)}
            items={session?.items ?? []}
            agentName={AGENT_NAMES[agent]}
            working={session?.working ?? false}
            compacting={session?.compacting ?? false}
            compaction={session?.compaction ?? null}
            statusText={statusText(
              AGENT_NAMES[agent],
              session?.status,
              session?.error ?? null,
            )}
            permissions={session?.permissions ?? []}
            onPermission={(id, allow, always, input, message) =>
              api.respond(leafId, id, allow, always, input, message)
            }
            onQuote={(text) => addQuote(leafId, text)}
            onReply={(text) => api.send(leafId, text, [])}
          />
        </Suspense>
      </div>
    </>
  );
}
