import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { CodexChatModel, type CodexTurn, unwrapShell } from "../lib/codexChat";
import { type CodexSnapshot, codexUsage } from "../lib/usage";
import type { ChatSession, ModelOption } from "./claudeChatStore";

type Store = { sessions: Record<number, ChatSession> };

/**
 * 每个终端窗格各自的 Codex 聊天会话(`codex app-server`,和 Codex 桌面版
 * 同一套协议)。跟 Claude 那边一样放在模块级,切回终端视图时会话不断。
 */
export const useCodexChatStore = create<Store>(() => ({ sessions: {} }));

type RpcId = number | string;
type RpcMessage = {
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
  terax?: string;
};

/** 一个 app-server 进程上的 JSON-RPC 连接。 */
class Conn {
  chatId: number | null = null;
  private nextId = 1;
  private pending = new Map<
    RpcId,
    {
      resolve: (r: Record<string, unknown>) => void;
      reject: (e: Error) => void;
    }
  >();
  /** 进程起来之前要发的行,拿到 chatId 后补发。 */
  private backlog: string[] = [];

  private write(obj: unknown) {
    const line = JSON.stringify(obj);
    if (this.chatId == null) {
      this.backlog.push(line);
      return;
    }
    void invoke("codex_chat_send", { id: this.chatId, line }).catch((e) =>
      this.failAll(String(e)),
    );
  }

  attach(chatId: number) {
    this.chatId = chatId;
    const lines = this.backlog;
    this.backlog = [];
    for (const line of lines) {
      void invoke("codex_chat_send", { id: chatId, line }).catch((e) =>
        this.failAll(String(e)),
      );
    }
  }

  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string) {
    this.write({ method });
  }

  respond(id: RpcId, result: Record<string, unknown>) {
    this.write({ id, result });
  }

  respondError(id: RpcId, message: string) {
    this.write({ id, error: { code: -32601, message } });
  }

  /** 是对我们请求的回复就消化掉,返回 true。 */
  settle(msg: RpcMessage): boolean {
    if (msg.id == null || msg.method) return false;
    const p = this.pending.get(msg.id);
    if (!p) return true;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "请求失败"));
    else p.resolve(msg.result ?? {});
    return true;
  }

  failAll(message: string) {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }
}

const models = new Map<number, CodexChatModel>();
const conns = new Map<number, Conn>();
/** 会话建好(拿到 threadId)之后才能发消息;在那之前发的等着它。 */
const ready = new Map<number, Promise<void>>();
/** 权限确认卡片的 id → app-server 那边请求的 id。 */
const asks = new Map<string, RpcId>();

const lastThreadKey = (cwd: string) => `terax.codexChat.lastThread:${cwd}`;

function lastThread(cwd: string): string | null {
  try {
    return localStorage.getItem(lastThreadKey(cwd));
  } catch {
    return null;
  }
}

function rememberThread(cwd: string, threadId: string | null) {
  try {
    if (threadId) localStorage.setItem(lastThreadKey(cwd), threadId);
    else localStorage.removeItem(lastThreadKey(cwd));
  } catch {}
}

const MODE_KEY = "terax.codexChat.permissionMode";
export const CODEX_MODES = ["readonly", "auto", "full"] as const;

/** 权限模式 → app-server 的审批策略 + 沙箱。 */
function modePolicy(mode: string | null) {
  switch (mode) {
    case "readonly":
      return {
        approvalPolicy: "on-request",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      };
    case "auto":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      };
    default:
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}

/** 上次在 Codex 聊天里选的权限;从没选过就是完全访问。 */
function startMode(): string {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v && (CODEX_MODES as readonly string[]).includes(v)) return v;
  } catch {}
  return "full";
}

function patch(leafId: number, next: Partial<ChatSession>) {
  useCodexChatStore.setState((s) => {
    const cur = s.sessions[leafId];
    if (!cur) return s;
    return { sessions: { ...s.sessions, [leafId]: { ...cur, ...next } } };
  });
}

function snapshot(leafId: number) {
  const m = models.get(leafId);
  if (!m) return;
  patch(leafId, {
    items: [...m.items],
    working: m.working,
    model: m.model,
    effort: m.effort,
    serviceTier: m.serviceTier,
    permissionMode: m.permissionMode,
    sessionId: m.threadId,
  });
}

/** 逐字输出的片段合并到下一帧再刷,不然一秒刷几十次界面会闪。 */
const pendingFrame = new Map<number, number>();
function snapshotNextFrame(leafId: number) {
  if (pendingFrame.has(leafId)) return;
  pendingFrame.set(
    leafId,
    requestAnimationFrame(() => {
      pendingFrame.delete(leafId);
      snapshot(leafId);
    }),
  );
}

/** Codex 要执行命令 / 改文件,等你点头:变成和 Claude 一样的确认卡片。 */
function handleServerRequest(leafId: number, conn: Conn, msg: RpcMessage) {
  const id = msg.id as RpcId;
  const params = (msg.params ?? {}) as {
    command?: string;
    reason?: string | null;
    itemId?: string;
    grantRoot?: string | null;
  };
  let toolName: string;
  let input: Record<string, unknown>;
  if (msg.method === "item/commandExecution/requestApproval") {
    toolName = "Bash";
    input = { command: unwrapShell(params.command ?? "") };
  } else if (msg.method === "item/fileChange/requestApproval") {
    toolName = "Edit";
    const card = models
      .get(leafId)
      ?.items.find((it) => it.kind === "tool" && it.id === params.itemId);
    const paths =
      card?.kind === "tool" && typeof card.input.file_path === "string"
        ? card.input.file_path
        : (params.grantRoot ?? "");
    input = { file_path: paths };
  } else {
    // 别的交互(追问、MCP 授权…)聊天里还没做界面,直接回绝,免得它一直等
    conn.respondError(id, "not supported in Terax chat");
    return;
  }
  if (params.reason) input.description = params.reason;
  const askId = `codex-${String(id)}`;
  asks.set(askId, id);
  const cur = useCodexChatStore.getState().sessions[leafId];
  if (!cur) return;
  patch(leafId, {
    permissions: [
      ...cur.permissions,
      { id: askId, toolName, input, blockedPath: null, canAlways: true },
    ],
  });
}

function handleLine(leafId: number, owner: Conn, line: string) {
  // 换过会话之后,旧进程晚到的消息不能落到新会话上
  if (conns.get(leafId) !== owner) return;
  let msg: RpcMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const m = models.get(leafId);
  if (!m) return;
  if (msg.terax === "closed") {
    owner.failAll("Codex 进程已退出");
    m.working = false;
    snapshot(leafId);
    patch(leafId, { status: "closed", permissions: [] });
    return;
  }
  if (owner.settle(msg)) return;
  if (msg.id != null && msg.method) {
    handleServerRequest(leafId, owner, msg);
    return;
  }
  if (!msg.method) return;
  if (msg.method === "serverRequest/resolved") {
    // 确认请求被那边撤了(比如这一轮被中断):卡片也收掉
    const rid = (msg.params as { requestId?: RpcId } | undefined)?.requestId;
    const cur = useCodexChatStore.getState().sessions[leafId];
    if (cur && rid != null) {
      patch(leafId, {
        permissions: cur.permissions.filter((p) => asks.get(p.id) !== rid),
      });
    }
    return;
  }
  if (msg.method === "account/rateLimits/updated") {
    // 每轮结束 app-server 都会推一次;面板开着时跟着刷新
    const snap = (msg.params as { rateLimits?: CodexSnapshot } | undefined)
      ?.rateLimits;
    if (snap) patch(leafId, { usage: codexUsage([snap]) });
    return;
  }
  if (m.notify(msg.method, (msg.params ?? {}) as never)) {
    if (msg.method === "item/agentMessage/delta") snapshotNextFrame(leafId);
    else snapshot(leafId);
  }
}

type ThreadResult = {
  thread?: { id?: string; turns?: CodexTurn[] };
  model?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
};

/** 起进程、握手、接着上次的会话(或开新的)。 */
async function boot(
  leafId: number,
  cwd: string,
  conn: Conn,
  m: CodexChatModel,
  resume: string | null,
) {
  await conn.request("initialize", {
    clientInfo: { name: "terax", title: "Terax", version: "0.1" },
    capabilities: null,
  });
  conn.notify("initialized");
  const policy = modePolicy(m.permissionMode);
  const base = {
    cwd,
    approvalPolicy: policy.approvalPolicy,
    sandbox: policy.sandbox,
  };
  let res: ThreadResult | null = null;
  if (resume) {
    try {
      res = (await conn.request("thread/resume", {
        ...base,
        threadId: resume,
      })) as ThreadResult;
    } catch {
      // 会话文件没了之类:开个新的
      res = null;
    }
  }
  if (!res) res = (await conn.request("thread/start", base)) as ThreadResult;
  if (conns.get(leafId) !== conn) return;
  m.threadId = res.thread?.id ?? null;
  m.model = res.model ?? m.model;
  m.effort = res.reasoningEffort ?? m.effort;
  m.serviceTier = res.serviceTier ?? m.serviceTier;
  if (res.thread?.turns?.length) {
    const live = m.items;
    m.items = [];
    m.loadHistory(res.thread.turns);
    m.items.push(...live);
  }
  rememberThread(cwd, m.threadId);
  snapshot(leafId);
  patch(leafId, { status: "ready" });
  // 模型按钮要显示名字("GPT-6 Astra"),强度滑条要知道各档:一开始就拉
  requestCodexModels(leafId);
}

/**
 * 这个窗格还没有 Codex 会话(或上一个已经结束)就起一个。默认接着这个目录
 * 上次的会话聊;`fresh` 开一个全新的。
 */
export function ensureCodexChat(leafId: number, cwd: string, fresh = false) {
  const cur = useCodexChatStore.getState().sessions[leafId];
  if (cur && cur.status !== "closed" && cur.status !== "error") return;
  const m = new CodexChatModel();
  m.permissionMode = startMode();
  const conn = new Conn();
  models.set(leafId, m);
  conns.set(leafId, conn);
  useCodexChatStore.setState((s) => ({
    sessions: {
      ...s.sessions,
      [leafId]: {
        chatId: null,
        status: "starting",
        error: null,
        items: [],
        working: false,
        model: null,
        permissionMode: m.permissionMode,
        sessionId: null,
        permissions: [],
        models: [],
      },
    },
  }));
  const channel = new Channel<string>();
  channel.onmessage = (line) => handleLine(leafId, conn, line);
  const resume = fresh ? null : lastThread(cwd);
  const started = invoke<number>("codex_chat_start", { cwd, onEvent: channel })
    .then((chatId) => {
      if (conns.get(leafId) !== conn) {
        void invoke("codex_chat_stop", { id: chatId });
        return;
      }
      conn.attach(chatId);
      patch(leafId, { chatId });
      return boot(leafId, cwd, conn, m, resume);
    })
    .catch((e) => {
      if (conns.get(leafId) !== conn) return;
      patch(leafId, { status: "error", error: String(e) });
      throw e;
    });
  ready.set(leafId, started);
  started.catch(() => {});
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

/** 图片直接给 Codex 看;别的文件列出路径让它自己读。 */
function buildInput(text: string, attachments: string[]) {
  const images = attachments.filter((f) => IMAGE_EXT.test(f));
  const others = attachments.filter((f) => !IMAGE_EXT.test(f));
  let body = text.trim();
  if (others.length) {
    const list = others.map((f) => `- ${f}`).join("\n");
    body =
      `${body}\n\n附件(${others.length} 个文件,请按路径读取):\n${list}`.trim();
  }
  if (!body && images.length) body = "请看附件";
  return [
    ...images.map((path) => ({ type: "localImage", path })),
    { type: "text", text: body, text_elements: [] },
  ];
}

export function sendCodex(
  leafId: number,
  text: string,
  attachments: string[] = [],
) {
  const m = models.get(leafId);
  const conn = conns.get(leafId);
  if (!m || !conn) return;
  m.addUser(text, attachments);
  snapshot(leafId);
  const policy = modePolicy(m.permissionMode);
  void (ready.get(leafId) ?? Promise.resolve())
    .then(() => {
      if (!m.threadId) throw new Error("会话还没建好");
      return conn.request("turn/start", {
        threadId: m.threadId,
        input: buildInput(text, attachments),
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
        ...(m.model ? { model: m.model } : {}),
        ...(m.effort ? { effort: m.effort } : {}),
        ...(m.serviceTier ? { serviceTier: m.serviceTier } : {}),
      });
    })
    .catch((e) => {
      m.working = false;
      m.addNote(`发送失败:${e instanceof Error ? e.message : String(e)}`);
      snapshot(leafId);
    });
}

export function respondCodexPermission(
  leafId: number,
  askId: string,
  allow: boolean,
  always = false,
) {
  const cur = useCodexChatStore.getState().sessions[leafId];
  const rid = asks.get(askId);
  const conn = conns.get(leafId);
  if (!cur) return;
  patch(leafId, { permissions: cur.permissions.filter((p) => p.id !== askId) });
  asks.delete(askId);
  if (rid === undefined || !conn) return;
  conn.respond(rid, {
    decision: allow ? (always ? "acceptForSession" : "accept") : "decline",
  });
}

export function interruptCodex(leafId: number) {
  const m = models.get(leafId);
  const conn = conns.get(leafId);
  if (!m?.threadId || !m.turnId || !conn) return;
  void conn
    .request("turn/interrupt", { threadId: m.threadId, turnId: m.turnId })
    .catch(() => {});
}

/**
 * 换模型:从下一轮开始生效(app-server 按轮带模型)。推理强度换成新模型
 * 的默认值 —— 旧的那档新模型不一定支持。
 */
export function setCodexModel(leafId: number, model: string) {
  const m = models.get(leafId);
  if (!m) return;
  m.model = model;
  const info = useCodexChatStore
    .getState()
    .sessions[leafId]?.models.find((x) => x.value === model);
  if (info?.defaultEffort) m.effort = info.defaultEffort;
  snapshot(leafId);
}

/** 推理强度,下一轮生效。 */
export function setCodexEffort(leafId: number, effort: string) {
  const m = models.get(leafId);
  if (!m) return;
  m.effort = effort;
  snapshot(leafId);
}

/** 快速档开关:"priority" = 快速,"default" = 标准。 */
export function setCodexServiceTier(leafId: number, tier: string) {
  const m = models.get(leafId);
  if (!m) return;
  m.serviceTier = tier;
  snapshot(leafId);
}

export function setCodexMode(leafId: number, mode: string) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {}
  const m = models.get(leafId);
  if (!m) return;
  m.permissionMode = mode;
  snapshot(leafId);
}

export function requestCodexModels(leafId: number) {
  const conn = conns.get(leafId);
  if (!conn) return;
  void (ready.get(leafId) ?? Promise.resolve())
    .then(() => conn.request("model/list", {}))
    .then((res) => {
      const data = (res.data ?? []) as {
        model?: string;
        displayName?: string;
        hidden?: boolean;
        isDefault?: boolean;
        defaultReasoningEffort?: string;
        supportedReasoningEfforts?: { reasoningEffort?: string }[];
        serviceTiers?: { id: string; name: string; description: string }[];
      }[];
      // 描述是一大段英文宣传语,菜单里不放(照 Codex 只列名字)
      const list: ModelOption[] = data
        .filter((d) => d.model && !d.hidden)
        .map((d) => ({
          value: d.model as string,
          displayName: d.displayName ?? (d.model as string),
          description: "",
          efforts: (d.supportedReasoningEfforts ?? [])
            .map((e) => e.reasoningEffort ?? "")
            .filter(Boolean),
          defaultEffort: d.defaultReasoningEffort,
          tiers: d.serviceTiers ?? [],
          isDefault: d.isDefault === true,
        }));
      patch(leafId, { models: list });
    })
    .catch(() => {});
}

/** 查套餐用量,结果落在 session.usage。 */
export function requestCodexUsage(leafId: number) {
  const conn = conns.get(leafId);
  if (!conn) return;
  void (ready.get(leafId) ?? Promise.resolve())
    .then(() => conn.request("account/rateLimits/read", {}))
    .then((res) => {
      const byId = res.rateLimitsByLimitId as
        | Record<string, CodexSnapshot>
        | null
        | undefined;
      const snaps = byId
        ? Object.values(byId)
        : [res.rateLimits as CodexSnapshot];
      patch(leafId, { usage: codexUsage(snaps) });
    })
    .catch(() => patch(leafId, { usage: null }));
}

export function compactCodex(leafId: number) {
  const m = models.get(leafId);
  const conn = conns.get(leafId);
  if (!m?.threadId || !conn) return;
  m.addNote("正在压缩上下文…");
  snapshot(leafId);
  void conn
    .request("thread/compact/start", { threadId: m.threadId })
    .catch((e) => {
      m.addNote(`压缩失败:${e instanceof Error ? e.message : String(e)}`);
      snapshot(leafId);
    });
}

/** 结束当前会话,开一个新的。 */
export function restartCodex(leafId: number, cwd: string) {
  const chatId = useCodexChatStore.getState().sessions[leafId]?.chatId;
  if (chatId != null) void invoke("codex_chat_stop", { id: chatId });
  useCodexChatStore.setState((s) => {
    const { [leafId]: _, ...rest } = s.sessions;
    return { sessions: rest };
  });
  models.delete(leafId);
  conns.delete(leafId);
  ready.delete(leafId);
  rememberThread(cwd, null);
  ensureCodexChat(leafId, cwd, true);
}
