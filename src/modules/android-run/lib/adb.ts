import { native } from "@/modules/ai/lib/native";

export type AdbDevice = {
  serial: string;
  state: "device" | "offline" | "unauthorized";
  /** Mainboard vendor identifier (ro.product.manufacturer) — HQ / YS / ShiMeTai. */
  vendor: string;
  model: string;
  androidVersion: string;
  apiLevel: string;
};

const ADB_TIMEOUT_SECS = 15;

async function adb(args: string, serial?: string): Promise<string> {
  const sel = serial ? `-s ${serial} ` : "";
  const out = await native.runCommand(
    `adb ${sel}${args}`,
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
        };
      }
      const [vendor, model, androidVersion, apiLevel] = await Promise.all([
        getprop(row.serial, "ro.product.manufacturer"),
        getprop(row.serial, "ro.product.model"),
        getprop(row.serial, "ro.build.version.release"),
        getprop(row.serial, "ro.build.version.sdk"),
      ]);
      return {
        ...row,
        vendor,
        model: model || row.serial,
        androidVersion,
        apiLevel,
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

/** Walk up from `startDir` looking for the gradle project root (settings.gradle[.kts]). */
export async function findProjectRoot(
  startDir: string,
): Promise<string | null> {
  let dir = startDir.replace(/\/+$/, "");
  for (let i = 0; i < 8 && dir.length > 1; i++) {
    if (
      (await hasFile(`${dir}/settings.gradle`)) ||
      (await hasFile(`${dir}/settings.gradle.kts`))
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
  const base = `adb -s ${serial} logcat -v threadtime`;
  return pid ? `${base} --pid=${pid}` : base;
}
