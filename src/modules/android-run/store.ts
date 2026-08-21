import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  type AdbDevice,
  discoverModules,
  findProjectRoot,
  listDevices,
  setAdbOverride,
} from "./lib/adb";

const ADB_PATH_KEY = "terax.android.adbPath";
// Apply any saved override before the first adb call.
const savedAdbPath =
  typeof localStorage !== "undefined"
    ? localStorage.getItem(ADB_PATH_KEY)
    : null;
setAdbOverride(savedAdbPath);

// Serial -> user note (e.g. "出入库"), so a subnet full of look-alike devices
// stays identifiable. Keyed by serial, not persistent device id — a device
// reconnecting over a different IP loses its note, same tradeoff as adbPath.
const DEVICE_NOTES_KEY = "terax.android.deviceNotes";
function loadDeviceNotes(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(DEVICE_NOTES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** A device ever seen online, kept around after it goes offline so it shows
 * up in the "调试设备" manager for one-click reconnect — keyed by SN (stable)
 * rather than serial (an IP:port that can change on the next DHCP lease). */
export type KnownDevice = {
  sn: string;
  serial: string;
  vendor: string;
  model: string;
  androidVersion: string;
  apiLevel: string;
  lastSeen: number;
};

const KNOWN_DEVICES_KEY = "terax.android.knownDevices";
function loadKnownDevices(): Record<string, KnownDevice> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KNOWN_DEVICES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Per-product device-panel config (device target, module, mirror state). */
type ProductConfig = {
  serial: string | null;
  module: string | null;
  modules: string[];
  mirroring: boolean;
};

const emptyConfig = (): ProductConfig => ({
  serial: null,
  module: null,
  modules: [],
  mirroring: false,
});

type AndroidRunState = {
  /** adb devices — genuinely global (same regardless of product). */
  devices: AdbDevice[];
  devicesLoading: boolean;

  /** Gradle project root of the active terminal tab; null outside a project. */
  projectRoot: string | null;
  /** Per-product panel config, keyed by project root. */
  byProduct: Record<string, ProductConfig>;
  /** 用户手动配置的 adb 绝对路径(空=自动解析)。 */
  adbPath: string;
  /** sn -> 用户备注(比如 "出入库"),本地持久化,按 SN 绑定不受 IP 变化影响。 */
  deviceNotes: Record<string, string>;
  /** sn -> 见过的设备(含离线的),用于"历史设备"面板。 */
  knownDevices: Record<string, KnownDevice>;
  /** 是否展开"历史设备"面板(渲染在镜像区域里,和投屏互斥)。 */
  deviceManagerOpen: boolean;

  setAdbPath: (path: string) => void;
  setDeviceNote: (serial: string, note: string) => void;
  forgetDevice: (sn: string) => void;
  setDeviceManagerOpen: (open: boolean) => void;
  refreshDevices: () => Promise<void>;
  /** Called when the active terminal cwd changes. */
  setProjectRoot: (cwd: string | null) => Promise<void>;
  selectDevice: (serial: string) => void;
  selectModule: (module: string) => void;
  setMirroring: (on: boolean) => void;
};

export const useAndroidRunStore = create<AndroidRunState>((set, get) => ({
  devices: [],
  devicesLoading: false,
  projectRoot: null,
  byProduct: {},
  adbPath: savedAdbPath ?? "",
  deviceNotes: loadDeviceNotes(),
  knownDevices: loadKnownDevices(),
  deviceManagerOpen: false,

  setDeviceManagerOpen: (open) => set({ deviceManagerOpen: open }),

  setAdbPath: (path) => {
    const v = path.trim();
    if (v) localStorage.setItem(ADB_PATH_KEY, v);
    else localStorage.removeItem(ADB_PATH_KEY);
    setAdbOverride(v || null);
    set({ adbPath: v });
    void get().refreshDevices();
  },

  setDeviceNote: (sn, note) =>
    set((s) => {
      const v = note.trim();
      const notes = { ...s.deviceNotes };
      if (v) notes[sn] = v;
      else delete notes[sn];
      localStorage.setItem(DEVICE_NOTES_KEY, JSON.stringify(notes));
      return { deviceNotes: notes };
    }),

  forgetDevice: (sn) =>
    set((s) => {
      const known = { ...s.knownDevices };
      delete known[sn];
      localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(known));
      const notes = { ...s.deviceNotes };
      delete notes[sn];
      localStorage.setItem(DEVICE_NOTES_KEY, JSON.stringify(notes));
      return { knownDevices: known, deviceNotes: notes };
    }),

  refreshDevices: async () => {
    if (get().devicesLoading) return;
    set({ devicesLoading: true });
    try {
      const devices = await listDevices();
      set((s) => {
        // Fix up any product whose chosen device went offline.
        const firstOnline = devices.find((d) => d.state === "device");
        const byProduct = { ...s.byProduct };
        for (const [root, cfg] of Object.entries(byProduct)) {
          const stillValid = devices.some(
            (d) => d.serial === cfg.serial && d.state === "device",
          );
          if (!stillValid) {
            byProduct[root] = { ...cfg, serial: firstOnline?.serial ?? null };
          }
        }
        // Remember every device we've actually talked to, for the "历史设备"
        // manager — keyed by SN so it survives the device's IP changing.
        // `lastSeen` tracks when it was last *selected*, not merely detected
        // online — refreshDevices runs constantly in the background, so
        // stamping it here would flatten every currently-online device to
        // ~the same timestamp and the "most recently used" sort would stop
        // meaning anything.
        const knownDevices = { ...s.knownDevices };
        for (const d of devices) {
          if (d.state !== "device" || !d.sn) continue;
          const existing = knownDevices[d.sn];
          knownDevices[d.sn] = {
            sn: d.sn,
            serial: d.serial,
            vendor: d.vendor,
            model: d.model,
            androidVersion: d.androidVersion,
            apiLevel: d.apiLevel,
            lastSeen: existing?.lastSeen ?? Date.now(),
          };
        }
        localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(knownDevices));
        return { devices, byProduct, knownDevices };
      });
    } catch {
      set({ devices: [] });
    } finally {
      set({ devicesLoading: false });
    }
  },

  setProjectRoot: async (cwd) => {
    const root = cwd ? await findProjectRoot(cwd) : null;
    set({ projectRoot: root });
    if (!root || get().byProduct[root]) return;
    // First time seeing this product: seed config + discover modules.
    const firstOnline = get().devices.find((d) => d.state === "device");
    set((s) => ({
      byProduct: {
        ...s.byProduct,
        [root]: { ...emptyConfig(), serial: firstOnline?.serial ?? null },
      },
    }));
    const modules = await discoverModules(root);
    set((s) => {
      const cfg = s.byProduct[root] ?? emptyConfig();
      return {
        byProduct: {
          ...s.byProduct,
          [root]: {
            ...cfg,
            modules,
            module: cfg.module ?? modules[0] ?? null,
          },
        },
      };
    });
  },

  selectDevice: (serial) =>
    set((s) => {
      const root = s.projectRoot;
      if (!root) return {};
      const cfg = s.byProduct[root] ?? emptyConfig();
      const patch: Partial<AndroidRunState> = {
        byProduct: { ...s.byProduct, [root]: { ...cfg, serial } },
      };
      // Bump this device to the top of "历史设备" — that's what "most
      // recently used" should track, not just "was seen online recently".
      const sn = s.devices.find((d) => d.serial === serial)?.sn;
      if (sn && s.knownDevices[sn]) {
        const knownDevices = {
          ...s.knownDevices,
          [sn]: { ...s.knownDevices[sn], lastSeen: Date.now() },
        };
        localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(knownDevices));
        patch.knownDevices = knownDevices;
      }
      return patch;
    }),

  selectModule: (module) =>
    set((s) => {
      const root = s.projectRoot;
      if (!root) return {};
      const cfg = s.byProduct[root] ?? emptyConfig();
      return { byProduct: { ...s.byProduct, [root]: { ...cfg, module } } };
    }),

  setMirroring: (on) =>
    set((s) => {
      const root = s.projectRoot;
      if (!root) return {};
      const cfg = s.byProduct[root] ?? emptyConfig();
      return {
        byProduct: { ...s.byProduct, [root]: { ...cfg, mirroring: on } },
      };
    }),
}));

const EMPTY = emptyConfig();

/** Config of the currently active product (empty defaults when none). */
export function useActiveProductConfig(): ProductConfig & {
  root: string | null;
} {
  return useAndroidRunStore(
    useShallow((s) => {
      const root = s.projectRoot;
      const cfg = (root && s.byProduct[root]) || EMPTY;
      return {
        root,
        serial: cfg.serial,
        module: cfg.module,
        modules: cfg.modules,
        mirroring: cfg.mirroring,
      };
    }),
  );
}

/**
 * Distinct device serials that any product currently wants mirrored. A mirror
 * belongs to a device, so it stays alive across product/tab switches — switching
 * back shows the same running stream instead of reconnecting.
 */
export function useMirroringSerials(): string[] {
  return useAndroidRunStore(
    useShallow((s) => {
      const serials = new Set<string>();
      for (const cfg of Object.values(s.byProduct)) {
        if (cfg.mirroring && cfg.serial) serials.add(cfg.serial);
      }
      return [...serials].sort();
    }),
  );
}
