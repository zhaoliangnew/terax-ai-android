import { beforeEach, describe, expect, it, vi } from "vitest";

type Rpc = { id?: number; method: string; params?: Record<string, unknown> };
const tauri = vi.hoisted(() => ({
  nextId: 0,
  channels: new Map<number, { onmessage: (line: string) => void }>(),
  requests: [] as Rpc[],
  rejectCompact: false,
  rejectSend: false,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => {};
  },
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === "codex_chat_start") {
      const id = ++tauri.nextId;
      tauri.channels.set(id, args.onEvent as never);
      return Promise.resolve(id);
    }
    if (command === "codex_chat_send") {
      const request = JSON.parse(String(args.line)) as Rpc;
      tauri.requests.push(request);
      if (request.id !== undefined) {
        const error =
          (request.method === "thread/compact/start" && tauri.rejectCompact) ||
          (request.method === "turn/start" && tauri.rejectSend);
        const result =
          request.method === "thread/start"
            ? { thread: { id: `thread-${args.id}` } }
            : request.method === "model/list"
              ? { data: [] }
              : {};
        queueMicrotask(() =>
          tauri.channels
            .get(Number(args.id))
            ?.onmessage(
              JSON.stringify(
                error
                  ? { id: request.id, error: { message: "request rejected" } }
                  : { id: request.id, result },
              ),
            ),
        );
      }
    }
    return Promise.resolve();
  },
}));
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
const codex = await import("@/modules/agents/store/codexChatStore");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let leafId = 900;
let chatId = 0;
const emit = (method: string, params: unknown) =>
  tauri.channels.get(chatId)?.onmessage(JSON.stringify({ method, params }));
const turns = () =>
  tauri.requests.filter((request) => request.method === "turn/start");
const session = () => codex.useCodexChatStore.getState().sessions[leafId];

beforeEach(async () => {
  tauri.requests.length = 0;
  tauri.rejectCompact = false;
  tauri.rejectSend = false;
  leafId++;
  codex.ensureCodexChat(leafId, "/repo", true);
  await flush();
  chatId = session().chatId as number;
  expect(session().status).toBe("ready");
});

describe("Codex compaction input delivery", () => {
  it("keeps input queued after RPC acknowledgement and item completion", async () => {
    codex.compactCodex(leafId);
    codex.compactCodex(leafId);
    codex.sendCodex(leafId, "one", ["/repo/image.png"]);
    codex.sendCodex(leafId, "two");
    await flush();
    expect(
      tauri.requests.filter(
        (request) => request.method === "thread/compact/start",
      ),
    ).toHaveLength(1);
    expect(session().compacting).toBe(true);
    expect(turns()).toHaveLength(0);
    emit("turn/started", { turn: { id: "compact" } });
    emit("item/started", { item: { id: "c", type: "contextCompaction" } });
    emit("item/completed", { item: { id: "c", type: "contextCompaction" } });
    await flush();
    expect(session().compaction?.phase).toBe("finishing");
    expect(turns()).toHaveLength(0);
    emit("turn/completed", { turn: { id: "compact", status: "completed" } });
    await flush();
    expect(turns()).toHaveLength(2);
    expect(turns()[0].params?.input).toContainEqual({
      type: "localImage",
      path: "/repo/image.png",
    });
    expect(turns()[0].params?.input).toContainEqual({
      type: "text",
      text: "one",
      text_elements: [],
    });
    expect(turns()[1].params?.input).toContainEqual({
      type: "text",
      text: "two",
      text_elements: [],
    });
    expect(session().items.filter((item) => item.kind === "user")).toHaveLength(
      2,
    );
  });

  it("clears progress when the compaction request is rejected", async () => {
    tauri.rejectCompact = true;
    codex.compactCodex(leafId);
    await flush();
    expect(session().compacting).toBe(false);
    expect(session().working).toBe(false);
    expect(
      session().items.some(
        (item) =>
          item.kind === "note" && item.text.includes("request rejected"),
      ),
    ).toBe(true);
  });

  it("does not deliver queued input after interruption or process exit", async () => {
    codex.compactCodex(leafId);
    codex.sendCodex(leafId, "queued");
    await flush();
    tauri.channels.get(chatId)?.onmessage(JSON.stringify({ terax: "closed" }));
    await flush();
    expect(turns()).toHaveLength(0);
    expect(session().compacting).toBe(false);
    expect(session().working).toBe(false);
    expect(session().status).toBe("closed");
  });

  it("does not send old queued input into a restarted conversation", async () => {
    codex.compactCodex(leafId);
    codex.sendCodex(leafId, "old");
    await flush();
    codex.restartCodex(leafId, "/repo");
    await flush();
    expect(turns()).toHaveLength(0);
    expect(session().items.filter((item) => item.kind === "user")).toHaveLength(
      0,
    );
  });

  it("does not mark an active turn idle when a new send is rejected", async () => {
    emit("turn/started", { turn: { id: "active" } });
    tauri.rejectSend = true;
    codex.sendCodex(leafId, "another message");
    await flush();
    expect(session().working).toBe(true);
  });
});
