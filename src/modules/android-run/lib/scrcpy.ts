import { Channel, invoke } from "@tauri-apps/api/core";
import { adbBin, ensureAdbResolved } from "./adb";

export type VideoEvent =
  | { kind: "size"; width: number; height: number }
  | {
      kind: "meta";
      config: boolean;
      keyFrame: boolean;
      pts: number;
      len: number;
      payload: Uint8Array;
    }
  | { kind: "error"; message: string }
  | { kind: "ended" };

/**
 * The Rust side sends each video event as one binary Channel message:
 * [u32 LE json-header-length][json header][raw payload].
 * Split it back apart here.
 */
function parseVideoMessage(bytes: ArrayBuffer): VideoEvent | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 4) return null;
  const headerLen = view.getUint32(0, true);
  const headerBytes = new Uint8Array(bytes, 4, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  if (header.kind === "size") {
    return { kind: "size", width: header.width, height: header.height };
  }
  if (header.kind === "meta") {
    return {
      kind: "meta",
      config: header.config,
      keyFrame: header.key_frame,
      pts: header.pts,
      len: header.len,
      payload: new Uint8Array(bytes, 4 + headerLen),
    };
  }
  if (header.kind === "error")
    return { kind: "error", message: header.message };
  if (header.kind === "ended") return { kind: "ended" };
  return null;
}

export async function scrcpyStart(
  serial: string,
  maxSize: number | null,
  displayId: number | null,
  onEvent: (e: VideoEvent) => void,
): Promise<number> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (bytes) => {
    const ev = parseVideoMessage(bytes);
    if (ev) onEvent(ev);
  };
  await ensureAdbResolved();
  return invoke<number>("scrcpy_start", {
    serial,
    adbPath: adbBin(),
    maxSize,
    displayId,
    onVideo: channel,
  });
}

/** Display ids on the device (0 = main; dual-screen adds e.g. 1 = 客显). */
export async function scrcpyListDisplays(serial: string): Promise<number[]> {
  await ensureAdbResolved();
  return invoke<number[]>("scrcpy_list_displays", {
    serial,
    adbPath: adbBin(),
  });
}

// AMOTION_EVENT_ACTION_*
export const TOUCH_DOWN = 0;
export const TOUCH_UP = 1;
export const TOUCH_MOVE = 2;

export function scrcpyTouch(
  id: number,
  action: number,
  x: number,
  y: number,
  pressure: number,
): Promise<void> {
  return invoke("scrcpy_touch", {
    id,
    action,
    x: Math.round(x),
    y: Math.round(y),
    pressure,
  });
}

// AKEYCODE_*
export const KEY_HOME = 3;
export const KEY_BACK = 4;
export const KEY_APP_SWITCH = 187;

export function scrcpyKey(id: number, keycode: number): Promise<void> {
  return invoke("scrcpy_key", { id, keycode });
}

export function scrcpyStop(id: number): Promise<void> {
  return invoke("scrcpy_stop", { id });
}
