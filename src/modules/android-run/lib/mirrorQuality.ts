import { create } from "zustand";

/** 投屏画质:自动按设备地址判断,或手动固定。 */
export type MirrorQuality = "auto" | "smooth" | "hd";

export type MirrorPreset = {
  maxSize: number;
  bitRate: number;
  maxFps: number;
};

/**
 * 流畅:跨公网(EasyTier/frp)用,码率压到 2 Mbps,断得少;
 * 高清:公司内网用,和以前一样(scrcpy 默认 8 Mbps、60 帧)。
 */
export const MIRROR_PRESETS: Record<"smooth" | "hd", MirrorPreset> = {
  smooth: { maxSize: 1280, bitRate: 2_000_000, maxFps: 20 },
  hd: { maxSize: 1600, bitRate: 8_000_000, maxFps: 60 },
};

/**
 * 自动时按 adb 地址判断:10.x 是组网的虚拟 IP(走公网),用流畅;
 * 192.168.x / 172.16-31.x 内网和 USB 线连的用高清。
 */
export function resolveMirrorQuality(
  quality: MirrorQuality,
  serial: string,
): "smooth" | "hd" {
  if (quality !== "auto") return quality;
  return /^10\.\d+\.\d+\.\d+:\d+$/.test(serial) ? "smooth" : "hd";
}

const KEY = "terax:mirror-quality";

function load(): MirrorQuality {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "auto" || v === "smooth" || v === "hd") return v;
  } catch {}
  return "auto";
}

export const useMirrorQuality = create<{
  quality: MirrorQuality;
  setQuality: (q: MirrorQuality) => void;
}>((set) => ({
  quality: load(),
  setQuality: (quality) => {
    try {
      localStorage.setItem(KEY, quality);
    } catch {}
    set({ quality });
  },
}));
