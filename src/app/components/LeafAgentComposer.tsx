import { cn } from "@/lib/utils";
import {
  saveAgent,
  savedAgent,
  savedView,
  saveView,
} from "@/modules/agents/lib/chatPrefs";
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

/** 终端里正在跑的是 Claude 还是 Codex(别的 agent / 没在跑就是 null)。 */
function asChatAgent(name: string | null | undefined): ChatAgent | null {
  return name === "claude" || name === "codex" || name === "qoder"
    ? name
    : null;
}

function runningAgent(leafId: number): ChatAgent | null {
  const pty = ptyIdForLeaf(leafId);
  return pty === null
    ? null
    : asChatAgent(useAgentActivityStore.getState().agents[pty]);
}

/**
 * 聊天用谁:这个窗格手动选过的 > 终端里正在跑的 > 这个目录上次用的 > 设置里的默认。
 */
function resolveAgent(leafId: number, cwd: string | null): ChatAgent {
  return (
    useAgentViewStore.getState().agents[leafId] ??
    runningAgent(leafId) ??
    savedAgent(cwd) ??
    usePreferencesStore.getState().defaultChatAgent
  );
}

/** 同上,给界面显示用(跟着终端里的 agent 变)。 */
function useLeafAgent(leafId: number, cwd: string | null): ChatAgent {
  const picked = useAgentViewStore((s) => s.agents[leafId]);
  const running = useAgentActivityStore((s) => {
    const pty = ptyIdForLeaf(leafId);
    return pty === null ? null : asChatAgent(s.agents[pty]);
  });
  const fallback = usePreferencesStore((s) => s.defaultChatAgent);
  return picked ?? running ?? savedAgent(cwd) ?? fallback;
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
  const who = pick ?? resolveAgent(leafId, dir);
  const store = useAgentViewStore.getState();
  store.setAgent(leafId, who);
  saveAgent(dir, who);
  CHAT_APIS[who].ensure(leafId, dir);
  store.setMode(leafId, "chat");
  saveView(dir, "chat");
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

const AGENT_OPTIONS: { value: CliAgent; label: string }[] = [
  { value: "claude", label: AGENT_NAMES.claude },
  { value: "codex", label: AGENT_NAMES.codex },
  { value: "qoder", label: AGENT_NAMES.qoder },
];

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
          `${AGENT_NAMES[agent]} 命令行已经在跑别的会话,退出后再点"命令行"就接上聊天`,
        );
    });
  }
  store.setMode(leafId, "cli");
}

/**
 * 窗格的 AI 选择(Claude | Codex | Qoder)和视图切换(聊天 | 命令行 | 终端)。
 * 当前窗格的摆在工程工具栏最左边,没有工具栏(或不是当前窗格)时浮在窗格右上角。
 */
export function LeafViewSwitch({ leafId, getCwd }: Props) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const setMode = useAgentViewStore((s) => s.setMode);
  const agent = useLeafAgent(leafId, getCwd(leafId));

  const openTerminal = () => {
    setMode(leafId, "terminal");
    saveView(getCwd(leafId), "terminal");
  };
  const show = (view: AgentViewMode, who: CliAgent) => {
    if (view === "chat") openLeafChat(leafId, getCwd, who);
    else if (view === "cli") openLeafCli(leafId, getCwd, who);
    else openTerminal();
  };
  // 换 AI:在聊天/命令行里就直接换过去;在终端里只记下来,之后点聊天/命令行时用它
  const pickAgent = (who: CliAgent) => {
    useAgentViewStore.getState().setAgent(leafId, who);
    saveAgent(getCwd(leafId), who);
    if (mode !== "terminal") show(mode, who);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Segmented
        title="用哪个 AI"
        options={AGENT_OPTIONS}
        value={agent}
        onPick={pickAgent}
      />
      <Segmented
        options={[
          { value: "chat", label: "聊天" },
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
  const agent = useLeafAgent(leafId, getCwd(leafId));
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);

  const modeSet = useAgentViewStore((s) => leafId in s.modes);

  // 窗格刚打开、还没切过:上次在这个目录用的是聊天,就直接回到聊天(接着
  // 上次的会话,历史会铺上)。终端的目录要等 shell 起来报过来,这个组件那时
  // 不一定会重新渲染,所以隔一会儿看一眼,拿到目录判断一次就收手。
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
      if (dir && savedView(dir) === "chat") openLeafChat(leafId, getCwd);
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
  // 进聊天时一定选定过了(openChat 会记下来)
  const agent = useAgentViewStore((s) => s.agents[leafId] ?? "claude");
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
  const agent = useAgentViewStore((s) => s.agents[leafId] ?? "claude");
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
