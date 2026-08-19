import { native } from "@/modules/ai/lib/native";
import { create } from "zustand";
import { pidOf } from "./lib/adb";

export type LogcatSession = {
  id: number;
  /** 所属产品(project root);"" = 不绑定产品(理论上不出现)。 */
  product: string;
  serial: string;
  /** null = 全量日志;有值 = 只看该包名进程 */
  pkg: string | null;
  label: string;
  handle: number | null;
  offset: number;
  lines: string[];
  paused: boolean;
  exited: boolean;
  exitCode: number | null;
  /** 包名会话当前附加的进程 pid(app 重启后用于探测切换) */
  attachedPid: string | null;
  error: string | null;
};

const MAX_LINES = 4000;
let nextId = 1;

type LogcatState = {
  sessions: LogcatSession[];
  activeSessionId: number | null;
  dockHeight: number;

  startSession: (
    product: string,
    serial: string,
    pkg: string | null,
  ) => Promise<void>;
  /** 通用命令会话(如「运行」的 gradle 输出),复用同一套 tab/轮询。 */
  startCommandSession: (
    product: string,
    label: string,
    command: string,
  ) => Promise<void>;
  /** 杀掉进程但保留输出 tab。 */
  stopSession: (id: number) => void;
  closeSession: (id: number) => void;
  setActiveSession: (id: number) => void;
  clearSession: (id: number) => void;
  togglePause: (id: number) => void;
  setDockHeight: (h: number) => void;
  pollAll: () => Promise<void>;
};

export const useLogcatStore = create<LogcatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  dockHeight: 240,

  startSession: async (product, serial, pkg) => {
    const id = nextId++;
    const shortSerial = serial.replace(/:\d+$/, "");
    const session: LogcatSession = {
      id,
      product,
      serial,
      pkg,
      label: pkg ? `${pkg} (${shortSerial})` : `Logcat (${shortSerial})`,
      handle: null,
      offset: 0,
      lines: [],
      paused: false,
      exited: false,
      exitCode: null,
      attachedPid: null,
      error: null,
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }));
    try {
      let cmd = `adb -s ${serial} logcat -v threadtime`;
      let attachedPid: string | null = null;
      if (pkg) {
        attachedPid = await pidOf(serial, pkg);
        if (attachedPid) cmd += ` --pid=${attachedPid}`;
      }
      const handle = await native.shellBgSpawn(cmd, null);
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === id ? { ...x, handle, attachedPid } : x,
        ),
      }));
    } catch (e) {
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === id ? { ...x, error: String(e) } : x,
        ),
      }));
    }
  },

  startCommandSession: async (product, label, command) => {
    const id = nextId++;
    const session: LogcatSession = {
      id,
      product,
      serial: "",
      pkg: null,
      label,
      handle: null,
      offset: 0,
      lines: [],
      paused: false,
      exited: false,
      exitCode: null,
      attachedPid: null,
      error: null,
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }));
    try {
      const handle = await native.shellBgSpawn(command, null);
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, handle } : x)),
      }));
    } catch (e) {
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === id ? { ...x, error: String(e) } : x,
        ),
      }));
    }
  },

  stopSession: (id) => {
    const session = get().sessions.find((x) => x.id === id);
    if (session?.handle != null)
      void native.shellBgKill(session.handle).catch(() => {});
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, exited: true } : x,
      ),
    }));
  },

  closeSession: (id) => {
    const session = get().sessions.find((x) => x.id === id);
    if (session?.handle != null)
      void native.shellBgKill(session.handle).catch(() => {});
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      return {
        sessions,
        activeSessionId:
          s.activeSessionId === id
            ? (sessions[sessions.length - 1]?.id ?? null)
            : s.activeSessionId,
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  clearSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, lines: [] } : x)),
    })),

  togglePause: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, paused: !x.paused } : x,
      ),
    })),

  setDockHeight: (h) => set({ dockHeight: Math.min(600, Math.max(140, h)) }),

  pollAll: async () => {
    const { sessions } = get();
    for (const session of sessions) {
      if (session.handle == null || session.exited) continue;
      try {
        const res = await native.shellBgLogs(session.handle, session.offset);
        if (!res.bytes && res.exited === session.exited) {
          if (res.exited && !session.exited) {
            set((s) => ({
              sessions: s.sessions.map((x) =>
                x.id === session.id
                  ? { ...x, exited: true, exitCode: res.exit_code }
                  : x,
              ),
            }));
          }
          continue;
        }
        const fresh = res.bytes.split("\n").filter((l) => l.length > 0);
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === session.id
              ? {
                  ...x,
                  offset: res.next_offset,
                  exited: res.exited,
                  exitCode: res.exited ? res.exit_code : x.exitCode,
                  lines:
                    x.lines.length + fresh.length > MAX_LINES
                      ? [...x.lines, ...fresh].slice(-MAX_LINES)
                      : [...x.lines, ...fresh],
                }
              : x,
          ),
        }));
      } catch {
        // transient poll failure — keep the session alive and retry next tick
      }
    }
    // app 重启后 pid 变化,但旧的 logcat --pid 不会退出(只是再也匹配不到行)。
    // 对包名会话周期性探测真实 pid,变了就换流重新附加(AS 行为)。
    for (const session of get().sessions) {
      if (!session.pkg || !session.serial) continue;
      const last = reattachAttemptAt.get(session.id) ?? 0;
      if (Date.now() - last < 3000) continue;
      reattachAttemptAt.set(session.id, Date.now());
      void ensureAttached(session.id, set, get);
    }
  },
}));

const reattachAttemptAt = new Map<number, number>();

async function ensureAttached(
  id: number,
  set: (
    fn: (s: {
      sessions: LogcatSession[];
    }) => Partial<{ sessions: LogcatSession[] }>,
  ) => void,
  get: () => { sessions: LogcatSession[] },
): Promise<void> {
  const session = get().sessions.find((x) => x.id === id);
  if (!session?.pkg || !session.serial) return;
  const pid = await pidOf(session.serial, session.pkg);
  // app 没在跑:流保持原样(exited 的等它回来,活着的反正也匹配不到行)。
  if (!pid) return;
  // 已附加到当前进程且流还活着,无需处理。
  if (pid === session.attachedPid && !session.exited) return;
  try {
    if (session.handle != null && !session.exited) {
      await native.shellBgKill(session.handle).catch(() => {});
    }
    const handle = await native.shellBgSpawn(
      `adb -s ${session.serial} logcat -v threadtime --pid=${pid}`,
      null,
    );
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id
          ? {
              ...x,
              handle,
              offset: 0,
              exited: false,
              exitCode: null,
              attachedPid: pid,
              lines: [...x.lines, `--- 进程变化,已重新附加 (pid=${pid}) ---`],
            }
          : x,
      ),
    }));
  } catch {
    // retry on the next tick
  }
}

/** Kill every logcat process (dock closed / app exit). */
export function killAllLogcatSessions(): void {
  for (const s of useLogcatStore.getState().sessions) {
    if (s.handle != null) void native.shellBgKill(s.handle).catch(() => {});
  }
}
