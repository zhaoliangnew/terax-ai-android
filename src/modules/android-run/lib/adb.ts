import { IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import {
  type AdbShellPlatform,
  buildAdbCommand,
  buildAdbDiscoveryCommand,
} from "@/modules/android-run/lib/adbShell";

export type AdbDevice = {
  serial: string;
  state: "device" | "offline" | "unauthorized";
  /** Mainboard vendor identifier (ro.product.manufacturer) — HQ / YS / ShiMeTai. */
  vendor: string;
  model: string;
  androidVersion: string;
  apiLevel: string;
  /** Hardware serial number (ro.serialno) — distinct from `serial`, which for
   * a network device is its "ip:port" adb connection address, not the SN. */
  sn: string;
  /** 设备上 /sdcard/key.txt 的内容(激活 key);没有该文件为空串。 */
  key: string;
};

const ADB_TIMEOUT_SECS = 5;

// Finder/Dock-launched apps get a minimal PATH (no ~/.zshrc additions), so a
// bare `adb` isn't found. Resolve its absolute path once from common install
// locations and use that everywhere.
let adbBinCache = "adb";
let adbResolved = false;
let adbOverride: string | null = null;

export function adbBin(): string {
  return adbBinCache;
}

/** User-configured adb path (highest priority). Empty/undefined clears it. */
export function setAdbOverride(path: string | null | undefined): void {
  adbOverride = path?.trim() || null;
  adbResolved = false; // re-resolve on next use
}

const ADB_SHELL_PLATFORM: AdbShellPlatform = IS_WINDOWS ? "windows" : "unix";

export async function ensureAdbResolved(): Promise<string> {
  if (adbResolved) return adbBinCache;
  adbResolved = true;
  // 用户手动设置优先。
  if (adbOverride) {
    adbBinCache = adbOverride;
    return adbBinCache;
  }
  adbBinCache = "adb";
  try {
    const script = buildAdbDiscoveryCommand(ADB_SHELL_PLATFORM);
    const out = await native.runCommand(script, null, 5);
    const found = out.stdout.trim().split("\n")[0]?.trim();
    if (found) adbBinCache = found;
  } catch {
    // keep default "adb"
  }
  return adbBinCache;
}

async function adb(args: string, serial?: string): Promise<string> {
  await ensureAdbResolved();
  const sel = serial ? `-s ${serial} ` : "";
  const out = await native.runCommand(
    buildAdbCommand(adbBinCache, `${sel}${args}`, ADB_SHELL_PLATFORM),
    null,
    ADB_TIMEOUT_SECS,
  );
  if (out.exit_code !== 0) {
    throw new Error(
      out.stderr.trim() || out.stdout.trim() || `adb ${args} failed`,
    );
  }
  return out.stdout;
}

async function getprop(serial: string, prop: string): Promise<string> {
  try {
    const out = await adb(`shell getprop ${prop}`, serial);
    return out.trim();
  } catch {
    return "";
  }
}

/** 设备激活 key(/sdcard/key/key.txt,key 是个目录)的第一行。
 * 没有文件/读不到返回空串。 */
async function readDeviceKey(serial: string): Promise<string> {
  try {
    const out = await adb("shell cat /sdcard/key/key.txt", serial);
    if (/no such file/i.test(out)) return "";
    return out.trim().split(/\r?\n/)[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** `adb connect <host[:port]>` — port defaults to 5555 (adb's TCP/IP default). */
export async function connectDevice(hostPort: string): Promise<void> {
  const target = hostPort.includes(":") ? hostPort : `${hostPort}:5555`;
  const out = await adb(`connect ${target}`);
  if (/unable to connect|failed to connect|cannot connect/i.test(out)) {
    throw new Error(out.trim());
  }
}

/** `adb disconnect <serial>` — only meaningful for TCP/IP devices (serial has a port). */
export async function disconnectDevice(serial: string): Promise<void> {
  await adb(`disconnect ${serial}`);
}

export async function listDevices(): Promise<AdbDevice[]> {
  const out = await adb("devices");
  const rows = out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      serial: parts[0],
      state: (parts[1] === "device"
        ? "device"
        : parts[1] === "unauthorized"
          ? "unauthorized"
          : "offline") as AdbDevice["state"],
    }));

  return Promise.all(
    rows.map(async (row) => {
      if (row.state !== "device") {
        return {
          ...row,
          vendor: "",
          model: row.serial,
          androidVersion: "",
          apiLevel: "",
          sn: "",
          key: "",
        };
      }
      const [vendor, model, androidVersion, apiLevel, sn, key] =
        await Promise.all([
          getprop(row.serial, "ro.product.manufacturer"),
          getprop(row.serial, "ro.product.model"),
          getprop(row.serial, "ro.build.version.release"),
          getprop(row.serial, "ro.build.version.sdk"),
          getprop(row.serial, "ro.serialno"),
          readDeviceKey(row.serial),
        ]);
      return {
        ...row,
        vendor,
        model: model || row.serial,
        androidVersion,
        apiLevel,
        sn,
        key,
      };
    }),
  );
}

async function hasFile(path: string): Promise<boolean> {
  try {
    const res = await native.readFile(path);
    return (
      res.kind === "text" || res.kind === "binary" || res.kind === "toolarge"
    );
  } catch {
    return false;
  }
}

/** True when `dir` is itself a gradle project root (has settings.gradle[.kts]). */
export async function isAndroidProjectDir(dir: string): Promise<boolean> {
  const d = dir.replace(/\/+$/, "");
  return (
    (await hasFile(`${d}/settings.gradle`)) ||
    (await hasFile(`${d}/settings.gradle.kts`))
  );
}

/** Walk up from `startDir` looking for a runnable project root:
 * gradle(settings.gradle[.kts])或 Flutter(带 flutter: 段的 pubspec.yaml)。
 *
 * Flutter 也要认:右侧那块设备栏(投屏/logcat/adb)对 Flutter 工程一样有用,
 * 只认 gradle 的话在 Flutter 工程里整块都不出现。 */
export async function findProjectRoot(
  startDir: string,
): Promise<string | null> {
  let dir = startDir.replace(/\/+$/, "");
  for (let i = 0; i < 8 && dir.length > 1; i++) {
    if (
      (await hasFile(`${dir}/settings.gradle`)) ||
      (await hasFile(`${dir}/settings.gradle.kts`)) ||
      (await isFlutterProjectDir(dir))
    ) {
      return dir;
    }
    const parent = dir.slice(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}

const INCLUDE_RE =
  /include\s*[( ]\s*(['"][^'"]+['"](?:\s*,\s*['"][^'"]+['"])*)/g;
const MODULE_RE = /['"]:?([^'"]+)['"]/g;

export async function discoverModules(projectRoot: string): Promise<string[]> {
  for (const name of ["settings.gradle.kts", "settings.gradle"]) {
    let content: string;
    try {
      const res = await native.readFile(`${projectRoot}/${name}`);
      if (res.kind !== "text") continue;
      content = res.content;
    } catch {
      continue;
    }
    const modules: string[] = [];
    for (const inc of content.matchAll(INCLUDE_RE)) {
      for (const m of inc[1].matchAll(MODULE_RE)) {
        modules.push(m[1].replace(/^:/, "").replace(/:/g, "/"));
      }
    }
    if (modules.length > 0) return modules;
  }
  return ["app"];
}

export type ProjectKind = "android" | "flutter";

/** Which kind of runnable project `dir` is, or null when it's a plain folder. */
export async function classifyProjectKind(
  dir: string,
): Promise<ProjectKind | null> {
  if (await isFlutterProjectDir(dir)) return "flutter";
  if (await isAndroidProjectDir(dir)) return "android";
  return null;
}

async function isFlutterProjectDir(dir: string): Promise<boolean> {
  const d = dir.replace(/\/+$/, "");
  try {
    const res = await native.readFile(`${d}/pubspec.yaml`);
    if (res.kind !== "text") return false;
    return /^flutter:\s*$/m.test(res.content);
  } catch {
    return false;
  }
}

/** True for a real Android app/library module or a Flutter project — not
 * just any gradle root (e.g. a plain JVM/Kotlin-multiplatform project). */
export async function isSupportedProductDir(dir: string): Promise<boolean> {
  if (await isFlutterProjectDir(dir)) return true;
  const modules = await discoverModules(dir);
  for (const m of modules) {
    if (await hasFile(`${dir}/${m}/src/main/AndroidManifest.xml`)) {
      return true;
    }
  }
  return false;
}

export type ApkMetadata = { applicationId: string };

export async function readApplicationId(
  projectRoot: string,
  module: string,
): Promise<string | null> {
  const metaPath = `${projectRoot}/${module}/build/outputs/apk/debug/output-metadata.json`;
  try {
    const res = await native.readFile(metaPath);
    if (res.kind !== "text") return null;
    const meta = JSON.parse(res.content);
    if (typeof meta.applicationId === "string") return meta.applicationId;
    for (const el of meta.elements ?? []) {
      if (typeof el.applicationId === "string") return el.applicationId;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function launchApp(
  serial: string,
  applicationId: string,
): Promise<void> {
  await adb(
    `shell monkey -p ${applicationId} -c android.intent.category.LAUNCHER 1`,
    serial,
  );
}

export async function pidOf(
  serial: string,
  applicationId: string,
): Promise<string | null> {
  try {
    const out = await adb(`shell pidof -s ${applicationId}`, serial);
    const pid = out.trim();
    return pid || null;
  } catch {
    return null;
  }
}

export function installCommand(module: string): string {
  return `sh ./gradlew :${module.replace(/\//g, ":")}:installDebug`;
}

export function logcatCommand(serial: string, pid?: string | null): string {
  const base = `${adbCmd()} -s ${serial} logcat -v threadtime`;
  return pid ? `${base} --pid=${pid}` : base;
}

/** Absolute-path adb prefix for hand-built command strings, e.g. `${adbCmd()} -s ...`. */
export function adbCmd(): string {
  return buildAdbCommand(adbBin(), "", ADB_SHELL_PLATFORM);
}
