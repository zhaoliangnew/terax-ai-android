import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  modes: {} as Record<number, string>,
  agents: {} as Record<number, string>,
  clis: {},
  quotes: {},
  injections: {},
  addQuote: vi.fn(),
  setMode: vi.fn(),
  setAgent: vi.fn(),
}));
const cleanups = vi.hoisted(() => [] as (() => void)[]);
const api = vi.hoisted(() => ({
  ensure: vi.fn(),
  suspend: vi.fn(),
  requestModels: vi.fn(),
  send: vi.fn(),
}));
const invoke = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
  },
  useState: (value: unknown) => [
    typeof value === "function" ? value() : value,
    vi.fn(),
  ],
}));
vi.mock("@/modules/agents/store/agentViewStore", () => ({
  useAgentViewStore: Object.assign(
    (select: (s: typeof state) => unknown) => select(state),
    { getState: () => state },
  ),
}));
vi.mock("@/modules/agents/store/chatProviders", () => ({
  AGENT_NAMES: { claude: "Claude", codex: "Codex" },
  CHAT_APIS: { claude: api, codex: api },
  useChatSession: () => session.value,
  chatSessionNow: (agent: string) =>
    agent === "claude" ? session.value : undefined,
}));
vi.mock("@/modules/agents/lib/chatPrefs", () => ({
  savedAgent: () => "claude",
  saveAgent: vi.fn(),
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({ visibleChatAgents: ["claude", "codex"] }),
    {
      getState: () => ({
        defaultChatAgent: "claude",
        visibleChatAgents: ["claude", "codex"],
      }),
    },
  ),
}));
vi.mock("@/modules/terminal", () => ({
  ptyIdForLeaf: () => null,
  TerminalPane: () => null,
  useAgentActivityStore: (select: (s: unknown) => unknown) =>
    select({ agents: {} }),
}));
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  leafHasForegroundJob: vi.fn(),
  whenSessionReady: vi.fn(),
  writeToSession: vi.fn(),
}));
vi.mock("@/tauri-apps/api/core", () => ({ invoke }));

import {
  LeafAgentChat,
  LeafAgentComposer,
  LeafViewSwitch,
} from "@/app/components/LeafAgentComposer";

type NodeProps = {
  children?: ReactNode;
  onClick?: () => void;
  onPick?: (value: string) => void;
  options?: { value: string }[];
  onSend?: (text: string, attachments: string[]) => void;
};
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const el = node as ReactElement<NodeProps>;
  return [el, ...elements(el.props?.children)];
}
const props = { leafId: 7, getCwd: () => "/repo" };

beforeEach(() => {
  vi.clearAllMocks();
  state.modes = {};
  state.agents = {};
  session.value = undefined;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe("手动恢复聊天会话", () => {
  it("新窗格只切到聊天,不连接 AI", () => {
    LeafAgentChat(props);
    expect(state.setMode).toHaveBeenCalledWith(7, "chat");
    expect(api.ensure).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("显示聊天和恢复按钮不会连接,点击恢复后才连接", () => {
    state.modes[7] = "chat";
    const tree = LeafAgentChat(props);
    expect(api.ensure).not.toHaveBeenCalled();
    const restore = elements(tree).find((el) => el.props.onClick);
    expect(restore).toBeDefined();
    restore?.props.onClick?.();
    expect(api.ensure).toHaveBeenCalledExactlyOnceWith(7, "/repo");
  });

  it.each(["closed", "error"])("%s 会话等待用户点击恢复", (status) => {
    state.modes[7] = "chat";
    session.value = { status, items: [] };
    const tree = LeafAgentChat(props);
    expect(api.ensure).not.toHaveBeenCalled();
    expect(elements(tree).some((el) => el.props.onClick)).toBe(true);
  });

  it("右栏占满时的紧凑聊天也提供手动恢复按钮,不自动连接", () => {
    state.modes[7] = "chat";
    const tree = LeafAgentComposer({ ...props, compact: true });
    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.requestModels).not.toHaveBeenCalled();
    const restore = elements(tree).find((el) => el.props.onClick);
    expect(restore).toBeDefined();
    restore?.props.onClick?.();
    expect(api.ensure).toHaveBeenCalledExactlyOnceWith(7, "/repo");
  });

  it("用户已发起连接时允许输入第一条消息,不会因等待 ready 卡住", () => {
    state.modes[7] = "chat";
    session.value = { status: "starting", items: [], models: [] };
    const tree = LeafAgentComposer(props);
    const composer = elements(tree).find((el) => el.props.onSend);
    expect(composer).toBeDefined();
    composer?.props.onSend?.("你好", []);
    expect(api.send).toHaveBeenCalledWith(7, "你好", []);
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it.each(["closed", "error"])("%s 时隐藏输入框且不请求模型", (status) => {
    state.modes[7] = "chat";
    session.value = { status, items: [], models: [] };
    expect(LeafAgentComposer(props)).toBeNull();
    expect(api.requestModels).not.toHaveBeenCalled();
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("切换 AI 只更换界面,不连接新的 AI", () => {
    state.modes[7] = "chat";
    const tree = LeafViewSwitch(props);
    const agents = elements(tree).find((el) =>
      el.props.options?.some((o) => o.value === "codex"),
    );
    expect(agents).toBeDefined();
    agents?.props.onPick?.("codex");
    expect(state.setAgent).toHaveBeenCalledWith(7, "codex");
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("在命令行模式更换 AI 不会自动启动新的命令行进程", () => {
    state.modes[7] = "cli";
    const tree = LeafViewSwitch(props);
    elements(tree)
      .find((el) => el.props.options?.some((o) => o.value === "codex"))
      ?.props.onPick?.("codex");
    expect(state.setMode).toHaveBeenCalledWith(7, "terminal");
    expect(invoke).not.toHaveBeenCalled();
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("设置关闭当前命令行 AI 时不会自动启动替代 AI", () => {
    state.modes[7] = "cli";
    state.agents[7] = "qoder";
    LeafAgentChat(props);
    expect(state.setMode).toHaveBeenCalledWith(7, "terminal");
    expect(invoke).not.toHaveBeenCalled();
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("目录还未就绪时,点击恢复也不连接", () => {
    state.modes[7] = "chat";
    const tree = LeafAgentChat({ ...props, getCwd: () => null });
    elements(tree)
      .find((el) => el.props.onClick)
      ?.props.onClick?.();
    expect(api.ensure).not.toHaveBeenCalled();
  });

  it("点击聊天视图只切换界面,不恢复连接", () => {
    const tree = LeafViewSwitch(props);
    const views = elements(tree).find((el) =>
      el.props.options?.some((o) => o.value === "chat"),
    );
    views?.props.onPick?.("chat");
    expect(state.setMode).toHaveBeenCalledWith(7, "chat");
    expect(api.ensure).not.toHaveBeenCalled();
  });
});
