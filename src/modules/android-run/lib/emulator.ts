import { Channel, invoke } from "@tauri-apps/api/core";
import { ensureAdbResolved } from "./adb";

export type ScaleProtocol = "xyd1" | "xyd2";

export type EmulatorIdentity = {
  brand: string;
  manufacturer: string;
  model: string;
  device: string;
  name: string;
  platform: string;
  displayId: string;
};

export type EmulatorProfile = {
  sourceSn: string;
  sourceLabel: string;
  identity: EmulatorIdentity;
  serialPorts: string[];
  scalePort: string | null;
  scaleProtocol: ScaleProtocol;
};

export type AvdInfo = {
  name: string;
  displayName: string;
  api: number | null;
  abi: string | null;
  width: number | null;
  height: number | null;
  profile: EmulatorProfile | null;
};

export type RunningEmulator = {
  serial: string;
  avd: string | null;
  booted: boolean;
};

export type EmulatorOverview = {
  sdkRoot: string | null;
  createBlocker: string | null;
  hostAbi: string;
  avds: AvdInfo[];
  running: RunningEmulator[];
};

export type PortMap = { path: string; devicePort: number; hostPort: number };

export type Prepared = {
  avd: string | null;
  ports: PortMap[];
  scalePort: string | null;
  scaleProtocol: ScaleProtocol;
};

export type DeviceFacts = {
  sn: string;
  api: number;
  release: string;
  abis: string[];
  width: number;
  height: number;
  density: number;
  identity: EmulatorIdentity;
  serialPorts: string[];
};

export type CreateEvent =
  | { kind: "step"; text: string }
  | { kind: "progress"; percent: number; text: string }
  | { kind: "done"; avd: string; serial: string }
  | { kind: "failed"; message: string };

export type ScaleSnapshot = {
  connected: boolean;
  netG: number;
  tareG: number;
  zeroG: number;
  stable: boolean;
  lastCommand: string | null;
};

export const isEmulatorSerial = (serial: string) =>
  /^emulator-\d+$/.test(serial);

/** Mirrors `suggest_avd_name` in the backend: AVD names are `[A-Za-z0-9._-]`. */
export function suggestAvdName(model: string, api: number): string {
  const base =
    model.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "Device";
  return `Leniu_${base}_API${api}`.slice(0, 64);
}

/** What the device list's search box and keyword chips match an emulator
 * against: its names, the device it was cloned from, model and serial. */
export function emulatorSearchText(
  avd: AvdInfo,
  serial?: string | null,
): string {
  const p = avd.profile;
  return [
    avd.displayName,
    avd.name,
    p?.sourceLabel,
    p?.sourceSn,
    p?.identity.manufacturer,
    p?.identity.model,
    serial,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export const isValidAvdName = (name: string) =>
  /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(name);

export function formatGrams(g: number): string {
  const sign = g < 0 ? "-" : "";
  const abs = Math.abs(g);
  return abs >= 1000
    ? `${sign}${(abs / 1000).toFixed(3)} kg`
    : `${sign}${abs} g`;
}

const adbPath = () => ensureAdbResolved();

export const emulatorApi = {
  overview: async () =>
    invoke<EmulatorOverview>("emulator_overview", { adbPath: await adbPath() }),
  start: async (avd: string) =>
    invoke<void>("emulator_start", { adbPath: await adbPath(), avd }),
  stop: async (serial: string) =>
    invoke<void>("emulator_stop", { adbPath: await adbPath(), serial }),
  logTail: (avd: string) => invoke<string>("emulator_log_tail", { avd }),
  setScale: (avd: string, scalePort: string, protocol: ScaleProtocol) =>
    invoke<void>("emulator_set_scale", { avd, scalePort, protocol }),
  remove: async (avd: string) =>
    invoke<void>("emulator_delete", { adbPath: await adbPath(), avd }),
  /** `rebuild` restarts every bridge; otherwise live ones are kept. */
  prepare: async (serial: string, rebuild = false) =>
    invoke<Prepared>("emulator_prepare", {
      adbPath: await adbPath(),
      serial,
      rebuild,
    }),
  probe: async (serial: string) =>
    invoke<DeviceFacts>("emulator_probe", { adbPath: await adbPath(), serial }),
  create: async (
    sourceSerial: string,
    name: string,
    displayName: string,
    onEvent: (e: CreateEvent) => void,
  ) => {
    const channel = new Channel<CreateEvent>();
    channel.onmessage = onEvent;
    await invoke<void>("emulator_create", {
      adbPath: await adbPath(),
      sourceSerial,
      name,
      displayName,
      onEvent: channel,
    });
  },
};

export const scaleApi = {
  start: (
    hostPort: number,
    protocol: ScaleProtocol,
    onEvent: (s: ScaleSnapshot) => void,
  ) => {
    const channel = new Channel<ScaleSnapshot>();
    channel.onmessage = onEvent;
    return invoke<number>("scale_sim_start", {
      hostPort,
      protocol,
      onEvent: channel,
    });
  },
  update: (id: number, grossG: number, shaking: boolean, over: boolean) =>
    invoke<void>("scale_sim_update", { id, grossG, shaking, over }),
  stop: (id: number) => invoke<void>("scale_sim_stop", { id }),
};
