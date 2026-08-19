import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  type AdbDevice,
  discoverModules,
  findProjectRoot,
  listDevices,
} from "./lib/adb";

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
        return { devices, byProduct };
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
      return { byProduct: { ...s.byProduct, [root]: { ...cfg, serial } } };
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
