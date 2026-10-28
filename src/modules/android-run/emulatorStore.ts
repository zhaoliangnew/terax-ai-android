import { create } from "zustand";
import {
  type CreateEvent,
  type EmulatorOverview,
  emulatorApi,
  type Prepared,
  type ScaleProtocol,
  type ScaleSnapshot,
  scaleApi,
} from "./lib/emulator";
import { useAndroidRunStore } from "./store";

const BOOT_TIMEOUT_MS = 7 * 60_000;
const POLL_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type CreateJob = {
  source: string;
  avd: string;
  steps: string[];
  progress: { percent: number; text: string } | null;
  status: "running" | "done" | "failed";
  message?: string;
};

export type ScaleSim = {
  id: number;
  port: string;
  hostPort: number;
  protocol: ScaleProtocol;
  grossG: number;
  shaking: boolean;
  over: boolean;
  snapshot: ScaleSnapshot | null;
};

type State = {
  overview: EmulatorOverview | null;
  loading: boolean;
  error: string | null;
  /** avd -> what it's doing right now ("启动中…"). */
  busy: Record<string, string>;
  /** avd -> last failure, shown on its card until the next attempt. */
  failures: Record<string, string>;
  /** serial -> serial ports bridged for that running emulator. */
  prepared: Record<string, Prepared>;
  prepareErrors: Record<string, string>;
  job: CreateJob | null;
  scales: Record<string, ScaleSim>;

  refresh: () => Promise<void>;
  ensurePrepared: (
    serial: string,
    force?: boolean,
    rebuild?: boolean,
  ) => Promise<Prepared | null>;
  start: (avd: string) => Promise<void>;
  stop: (avd: string) => Promise<void>;
  remove: (avd: string) => Promise<void>;
  createFromDevice: (
    source: string,
    avd: string,
    displayName: string,
  ) => Promise<void>;
  dismissJob: () => void;
  startScale: (
    serial: string,
    port?: string,
    protocol?: ScaleProtocol,
  ) => Promise<void>;
  setLoad: (
    serial: string,
    patch: Partial<Pick<ScaleSim, "grossG" | "shaking" | "over">>,
  ) => void;
  stopScale: (serial: string) => void;
};

const preparing = new Map<string, Promise<Prepared | null>>();

function runningSerial(o: EmulatorOverview | null, avd: string) {
  return o?.running.find((r) => r.avd === avd) ?? null;
}

function patchRecord<T>(rec: Record<string, T>, key: string, value?: T) {
  const next = { ...rec };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export const useEmulatorStore = create<State>((set, get) => ({
  overview: null,
  loading: false,
  error: null,
  busy: {},
  failures: {},
  prepared: {},
  prepareErrors: {},
  job: null,
  scales: {},

  refresh: async () => {
    set({ loading: true });
    try {
      const overview = await emulatorApi.overview();
      const live = new Set(overview.running.map((r) => r.serial));
      set((s) => ({
        overview,
        error: null,
        prepared: Object.fromEntries(
          Object.entries(s.prepared).filter(([k]) => live.has(k)),
        ),
      }));
      for (const r of overview.running) {
        const avd = overview.avds.find((a) => a.name === r.avd);
        if (r.booted && avd?.profile && !get().prepared[r.serial]) {
          void get().ensurePrepared(r.serial);
        }
      }
      for (const serial of Object.keys(get().scales)) {
        if (!live.has(serial)) get().stopScale(serial);
      }
    } catch (e) {
      set({ error: errText(e) });
    } finally {
      set({ loading: false });
    }
  },

  ensurePrepared: (serial, force = false, rebuild = false) => {
    if (!force && get().prepared[serial])
      return Promise.resolve(get().prepared[serial]);
    const pending = preparing.get(serial);
    if (pending) return pending;
    const p = emulatorApi
      .prepare(serial, rebuild)
      .then((prep) => {
        set((s) => ({
          prepared: patchRecord(s.prepared, serial, prep),
          prepareErrors: patchRecord(s.prepareErrors, serial),
        }));
        return prep;
      })
      .catch((e) => {
        set((s) => ({
          prepareErrors: patchRecord(s.prepareErrors, serial, errText(e)),
        }));
        return null;
      })
      .finally(() => preparing.delete(serial));
    preparing.set(serial, p);
    return p;
  },

  start: async (avd) => {
    if (get().busy[avd]) return;
    set((s) => ({
      busy: patchRecord(s.busy, avd, "启动中…"),
      failures: patchRecord(s.failures, avd),
    }));
    try {
      await emulatorApi.start(avd);
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      let serial: string | null = null;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const o = await emulatorApi.overview();
        set({ overview: o });
        const r = runningSerial(o, avd);
        if (r && !r.booted) {
          set((s) => ({ busy: patchRecord(s.busy, avd, "系统启动中…") }));
        }
        if (r?.booted) {
          serial = r.serial;
          break;
        }
      }
      if (!serial) {
        const log = await emulatorApi.logTail(avd).catch(() => "");
        throw new Error(`7 分钟内没启动完${log ? `\n${log}` : ""}`);
      }
      if (hasProfile(get().overview, avd)) {
        set((s) => ({ busy: patchRecord(s.busy, avd, "建立串口…") }));
        await get().ensurePrepared(serial, true);
      }
      const run = useAndroidRunStore.getState();
      await run.refreshDevices();
      run.selectDevice(serial);
      run.setMirroring(true);
    } catch (e) {
      set((s) => ({ failures: patchRecord(s.failures, avd, errText(e)) }));
    } finally {
      set((s) => ({ busy: patchRecord(s.busy, avd) }));
    }
  },

  stop: async (avd) => {
    const r = runningSerial(get().overview, avd);
    if (!r || get().busy[avd]) return;
    set((s) => ({ busy: patchRecord(s.busy, avd, "关闭中…") }));
    try {
      get().stopScale(r.serial);
      await emulatorApi.stop(r.serial);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await sleep(1000);
        const o = await emulatorApi.overview();
        set({ overview: o });
        if (!runningSerial(o, avd)) break;
      }
      set((s) => ({ prepared: patchRecord(s.prepared, r.serial) }));
      void useAndroidRunStore.getState().refreshDevices();
    } catch (e) {
      set((s) => ({ failures: patchRecord(s.failures, avd, errText(e)) }));
    } finally {
      set((s) => ({ busy: patchRecord(s.busy, avd) }));
    }
  },

  remove: async (avd) => {
    try {
      await emulatorApi.remove(avd);
      await get().refresh();
    } catch (e) {
      set((s) => ({ failures: patchRecord(s.failures, avd, errText(e)) }));
    }
  },

  createFromDevice: async (source, avd, displayName) => {
    if (get().job?.status === "running") return;
    set({
      job: { source, avd, steps: [], progress: null, status: "running" },
    });
    const onEvent = (e: CreateEvent) => {
      const job = get().job;
      if (!job || job.avd !== avd) return;
      if (e.kind === "step") {
        set({ job: { ...job, steps: [...job.steps, e.text], progress: null } });
      } else if (e.kind === "progress") {
        set({
          job: { ...job, progress: { percent: e.percent, text: e.text } },
        });
      } else if (e.kind === "done") {
        set({ job: { ...job, status: "done", progress: null } });
        void get()
          .refresh()
          .then(async () => {
            const run = useAndroidRunStore.getState();
            await run.refreshDevices();
            run.selectDevice(e.serial);
            run.setMirroring(true);
          });
      } else {
        set({ job: { ...job, status: "failed", message: e.message } });
        void get().refresh();
      }
    };
    try {
      await emulatorApi.create(source, avd, displayName, onEvent);
    } catch (e) {
      set({
        job: {
          source,
          avd,
          steps: [],
          progress: null,
          status: "failed",
          message: errText(e),
        },
      });
    }
  },

  dismissJob: () => {
    if (get().job?.status !== "running") set({ job: null });
  },

  startScale: async (serial, port, protocol) => {
    const prep = await get().ensurePrepared(serial);
    if (!prep?.ports.length) return;
    const portPath = port ?? get().scales[serial]?.port ?? prep.scalePort;
    const map = prep.ports.find((p) => p.path === portPath) ?? prep.ports[0];
    const proto =
      protocol ?? get().scales[serial]?.protocol ?? prep.scaleProtocol;
    const prev = get().scales[serial];
    if (prev) void scaleApi.stop(prev.id);
    // Snapshots can arrive before `start` resolves; hold the latest until
    // the sim is registered so the first state isn't lost.
    let simId: number | null = null;
    let early: ScaleSnapshot | null = null;
    const id = await scaleApi.start(map.hostPort, proto, (snapshot) => {
      const cur = get().scales[serial];
      if (simId === null) early = snapshot;
      else if (cur?.id === simId) {
        set((s) => ({
          scales: patchRecord(s.scales, serial, { ...cur, snapshot }),
        }));
      }
    });
    simId = id;
    const sim: ScaleSim = {
      id,
      port: map.path,
      hostPort: map.hostPort,
      protocol: proto,
      grossG: prev?.grossG ?? 0,
      shaking: prev?.shaking ?? false,
      over: prev?.over ?? false,
      snapshot: early,
    };
    set((s) => ({ scales: patchRecord(s.scales, serial, sim) }));
    void scaleApi.update(id, sim.grossG, sim.shaking, sim.over);
    if (
      prep.avd &&
      (map.path !== prep.scalePort || proto !== prep.scaleProtocol)
    ) {
      void emulatorApi.setScale(prep.avd, map.path, proto).catch(() => {});
      set((s) => ({
        prepared: patchRecord(s.prepared, serial, {
          ...prep,
          scalePort: map.path,
          scaleProtocol: proto,
        }),
      }));
    }
  },

  setLoad: (serial, patch) => {
    const cur = get().scales[serial];
    if (!cur) return;
    const next = { ...cur, ...patch };
    set((s) => ({ scales: patchRecord(s.scales, serial, next) }));
    void scaleApi.update(next.id, next.grossG, next.shaking, next.over);
  },

  stopScale: (serial) => {
    const cur = get().scales[serial];
    if (!cur) return;
    void scaleApi.stop(cur.id);
    set((s) => ({ scales: patchRecord(s.scales, serial) }));
  },
}));

function hasProfile(o: EmulatorOverview | null, avd: string) {
  return !!o?.avds.find((a) => a.name === avd)?.profile;
}
