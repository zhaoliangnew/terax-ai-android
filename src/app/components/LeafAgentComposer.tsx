import { cn } from "@/lib/utils";
import { useAgentViewStore } from "@/modules/agents/store/agentViewStore";
import {
  AGENT_NAMES,
  CHAT_APIS,
  type ChatAgent,
  useChatSession,
} from "@/modules/agents/store/chatProviders";
import { ptyIdForLeaf, useAgentActivityStore } from "@/modules/terminal";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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

const viewKey = (cwd: string) => `terax.chat.view:${cwd}`;

/** 这个目录上次是聊天还是终端;重开窗格时照着恢复。 */
function savedView(cwd: string): "chat" | "terminal" | null {
  try {
    const v = localStorage.getItem(viewKey(cwd));
    return v === "chat" || v === "terminal" ? v : null;
  } catch {
    return null;
  }
}

function saveView(cwd: string | null, view: "chat" | "terminal") {
  if (!cwd) return;
  try {
    localStorage.setItem(viewKey(cwd), view);
  } catch {}
}

const agentKey = (cwd: string) => `terax.chat.agent:${cwd}`;

/** 这个目录上次聊天用的是 Claude 还是 Codex。 */
function savedAgent(cwd: string | null): ChatAgent | null {
  if (!cwd) return null;
  try {
    const v = localStorage.getItem(agentKey(cwd));
    return v === "claude" || v === "codex" ? v : null;
  } catch {
    return null;
  }
}

function saveAgent(cwd: string | null, agent: ChatAgent) {
  if (!cwd) return;
  try {
    localStorage.setItem(agentKey(cwd), agent);
  } catch {}
}

/** 终端里正在跑的是 Claude 还是 Codex(别的 agent / 没在跑就是 null)。 */
function asChatAgent(name: string | null | undefined): ChatAgent | null {
  return name === "claude" || name === "codex" ? name : null;
}

function runningAgent(leafId: number): ChatAgent | null {
  const pty = ptyIdForLeaf(leafId);
  return pty === null
    ? null
    : asChatAgent(useAgentActivityStore.getState().agents[pty]);
}

/**
 * 聊天用谁:这个窗格手动选过的 > 终端里正在跑的 > 这个目录上次用的 > Claude。
 */
function resolveAgent(leafId: number, cwd: string | null): ChatAgent {
  return (
    useAgentViewStore.getState().agents[leafId] ??
    runningAgent(leafId) ??
    savedAgent(cwd) ??
    "claude"
  );
}

/** 同上,给界面显示用(跟着终端里的 agent 变)。 */
function useLeafAgent(leafId: number, cwd: string | null): ChatAgent {
  const picked = useAgentViewStore((s) => s.agents[leafId]);
  const running = useAgentActivityStore((s) => {
    const pty = ptyIdForLeaf(leafId);
    return pty === null ? null : asChatAgent(s.agents[pty]);
  });
  return picked ?? running ?? savedAgent(cwd) ?? "claude";
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

/** 右上角的 Claude / Codex 选择。 */
function AgentPicker({
  agent,
  onPick,
}: {
  agent: ChatAgent;
  onPick: (agent: ChatAgent) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="聊天用 Claude 还是 Codex"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {AGENT_NAMES[agent]}
        <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1.5 flex min-w-32 flex-col rounded-xl border border-border bg-popover p-1 shadow-xl"
        >
          {(["claude", "codex"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={a === agent}
              onClick={() => {
                setOpen(false);
                onPick(a);
              }}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-foreground/10"
            >
              {AGENT_NAMES[a]}
              {a === agent && (
                <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 盖在终端窗格上面的聊天视图 + 右上角"Claude/Codex"和"聊天 / 终端"切换。
 * 聊天是一个独立的会话(Claude Agent SDK 或 codex app-server),在这个窗格
 * 的目录里跑;终端一直在下面,切回去就是原样。
 */
export function LeafAgentChat({ leafId, getCwd }: Props) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const setMode = useAgentViewStore((s) => s.setMode);
  const setAgent = useAgentViewStore((s) => s.setAgent);
  const addQuote = useAgentViewStore((s) => s.addQuote);
  const agent = useLeafAgent(leafId, getCwd(leafId));
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);

  const modeSet = useAgentViewStore((s) => leafId in s.modes);

  // 目录在点的那一刻现场读:终端刚 cd 完、这个组件还没重新渲染时,
  // 渲染时拿到的 cwd 还是空的
  const openChat = (pick?: ChatAgent) => {
    const dir = getCwd(leafId);
    if (!dir) {
      toast.error("这个终端还不知道在哪个目录,先在里面 cd 一下");
      return;
    }
    const who = pick ?? resolveAgent(leafId, dir);
    setAgent(leafId, who);
    saveAgent(dir, who);
    CHAT_APIS[who].ensure(leafId, dir);
    setMode(leafId, "chat");
    saveView(dir, "chat");
  };
  const openTerminal = () => {
    setMode(leafId, "terminal");
    saveView(getCwd(leafId), "terminal");
  };
  // 在终端视图里选:只记下来,点"聊天"时用它;在聊天里选:直接换过去
  const pickAgent = (who: ChatAgent) => {
    if (mode === "chat") {
      openChat(who);
      return;
    }
    setAgent(leafId, who);
    saveAgent(getCwd(leafId), who);
  };

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
      if (dir && savedView(dir) === "chat") openChat();
    }, 250);
    return () => clearInterval(timer);
  }, [modeSet]);

  const seg = (on: boolean) =>
    cn(
      "h-6 cursor-pointer rounded-md px-2.5 text-[11.5px] transition-colors",
      on
        ? "bg-foreground/15 text-foreground"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <>
      {mode === "chat" && (
        <Suspense fallback={null}>
          <AgentChatView
            items={session?.items ?? []}
            agentName={AGENT_NAMES[agent]}
            working={session?.working ?? false}
            statusText={statusText(
              AGENT_NAMES[agent],
              session?.status,
              session?.error ?? null,
            )}
            permissions={session?.permissions ?? []}
            onPermission={(id, allow, always) =>
              api.respond(leafId, id, allow, always)
            }
            onQuote={(text) => addQuote(leafId, text)}
          />
        </Suspense>
      )}
      <div className="absolute top-2 right-3 z-20 flex gap-0.5 rounded-lg border border-border bg-background/90 p-0.5 backdrop-blur">
        <AgentPicker agent={agent} onPick={pickAgent} />
        <span className="my-1 w-px bg-border" />
        <button
          type="button"
          onClick={() => openChat()}
          className={seg(mode === "chat")}
        >
          聊天
        </button>
        <button
          type="button"
          onClick={openTerminal}
          className={seg(mode === "terminal")}
        >
          终端
        </button>
      </div>
    </>
  );
}

/** 聊天模式下窗格底部的输入框;终端模式下不出现。 */
export function LeafAgentComposer({ leafId, getCwd }: Props) {
  const mode = useAgentViewStore((s) => s.modes[leafId] ?? "terminal");
  const quote = useAgentViewStore((s) => s.quotes[leafId] ?? null);
  const injection = useAgentViewStore((s) => s.injections[leafId] ?? null);
  // 进聊天时一定选定过了(openChat 会记下来)
  const agent = useAgentViewStore((s) => s.agents[leafId] ?? "claude");
  const api = CHAT_APIS[agent];
  const session = useChatSession(agent, leafId);
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
        serviceTier={session?.serviceTier ?? null}
        onSetEffort={(e) => api.setEffort?.(leafId, e)}
        onSetServiceTier={(t) => api.setServiceTier?.(leafId, t)}
        usage={session?.usage}
        onOpenUsage={() => api.requestUsage(leafId)}
        onCompact={() => api.compact(leafId)}
        onNewChat={() => {
          const dir = cwd();
          if (dir) api.restart(leafId, dir);
        }}
      />
    </Suspense>
  );
}
