import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** 一条批注:位置按视频帧的百分比记(0..1),不随窗口大小变。 */
export type Mark = {
  id: number;
  xPct: number;
  yPct: number;
  note: string;
  /** 标注点周围一小块的缩略图(dataURL),给列表卡片当预览。 */
  thumb: string;
};

/** 裁标注点周围一小块当缩略图(照 Codex 列表里那张小图)。 */
export function cropThumb(
  source: HTMLCanvasElement,
  xPct: number,
  yPct: number,
) {
  const w = source.width;
  const h = source.height;
  const side = Math.round(Math.min(w, h) * 0.16);
  const sx = Math.max(0, Math.min(w - side, Math.round(xPct * w - side / 2)));
  const sy = Math.max(0, Math.min(h - side, Math.round(yPct * h - side / 2)));
  const out = document.createElement("canvas");
  out.width = 64;
  out.height = 64;
  const ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, 64, 64);
  return out.toDataURL("image/png");
}

/** 视频在 canvas 盒子里 object-contain 之后实际画出来的那块区域(CSS 像素)。 */
export function letterbox(
  boxW: number,
  boxH: number,
  frameW: number,
  frameH: number,
) {
  if (boxW === 0 || boxH === 0 || frameW === 0 || frameH === 0) {
    return { offX: 0, offY: 0, drawW: boxW, drawH: boxH };
  }
  const boxRatio = boxW / boxH;
  const frameRatio = frameW / frameH;
  let drawW = boxW;
  let drawH = boxH;
  let offX = 0;
  let offY = 0;
  if (boxRatio > frameRatio) {
    drawW = boxH * frameRatio;
    offX = (boxW - drawW) / 2;
  } else {
    drawH = boxW / frameRatio;
    offY = (boxH - drawH) / 2;
  }
  return { offX, offY, drawW, drawH };
}

/**
 * 把当前投屏画面连同批注编号画到一张图上,存成临时文件,返回路径。
 * 直接用投屏那块 canvas 的内容(已经是视频帧分辨率),再叠编号圆点。
 */
export async function captureAnnotated(
  source: HTMLCanvasElement,
  marks: readonly Mark[],
): Promise<string> {
  const w = source.width;
  const h = source.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("拿不到画布上下文");
  ctx.drawImage(source, 0, 0, w, h);

  // 圆点大小跟着分辨率走,截图缩放后还看得清
  const r = Math.max(14, Math.round(Math.min(w, h) * 0.022));
  ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, Math.round(r * 0.14));
  marks.forEach((m, i) => {
    const cx = m.xPct * w;
    const cy = m.yPct * h;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#2c67c5";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(i + 1), cx, cy + r * 0.05);
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("截图失败");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<string>("chat_save_image", bytes, {
    headers: { "x-ext": "png" },
  });
}

/** 批注列表汇成给模型看的文字。 */
export function annotationText(marks: readonly Mark[]): string {
  const lines = marks.map((m, i) => {
    const note = m.note.trim() || "(未写说明)";
    return `${i + 1}. ${note}`;
  });
  return `这是当前设备投屏的截图,我在上面标了 ${marks.length} 处(编号对应图中圆点):\n${lines.join("\n")}`;
}

/**
 * 哪台设备的投屏正处于批注模式。放在模块级 store,好让"批注"开关摆到
 * DevicePanel 的设备名那一行,而画面上的批注层在 ScreenMirror 里。
 */
type AnnotateState = {
  serial: string | null;
  toggle: (serial: string) => void;
  close: () => void;
};

export const useMirrorAnnotate = create<AnnotateState>((set) => ({
  serial: null,
  toggle: (serial) =>
    set((s) => ({ serial: s.serial === serial ? null : serial })),
  close: () => set({ serial: null }),
}));
