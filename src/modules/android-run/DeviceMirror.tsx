import { useEffect, useRef, useState } from "react";
import { scrcpyListDisplays } from "./lib/scrcpy";
import { ScreenMirror } from "./ScreenMirror";

type Props = {
  serial: string;
  /** Hidden mirrors keep decoding in the background so switching back is instant. */
  visible: boolean;
};

// Rough label+nav-bar height reserved by each ScreenMirror around its canvas.
const CHROME_PX = 56;

function fitArea(boxW: number, boxH: number, ratio: number): number {
  if (boxW <= 0 || boxH <= 0) return 0;
  const w = Math.min(boxW, boxH * ratio);
  const h = w / ratio;
  return w * h;
}

/**
 * One physical device's mirror (main + any secondary displays). Kept mounted
 * while any product mirrors this serial, so tab/product switches never drop the
 * scrcpy connection — only visibility toggles.
 */
export function DeviceMirror({ serial, visible }: Props) {
  const [displays, setDisplays] = useState<number[]>([0]);
  useEffect(() => {
    let cancelled = false;
    // Re-poll rather than check once: a display only reports mHasContent
    // once the on-device app actually starts presenting to it, which can
    // happen well after mirroring starts — pick it up without requiring a
    // manual stop/restart. Only ever grow the set (never drop a display
    // whose content later goes idle again) to avoid tearing down a live
    // mirror connection on a transient flicker.
    const poll = () => {
      void scrcpyListDisplays(serial)
        .then((ids) => {
          if (cancelled || ids.length === 0) return;
          setDisplays((prev) => {
            const merged = Array.from(new Set([...prev, ...ids])).sort(
              (a, b) => a - b,
            );
            return merged.length === prev.length &&
              merged.every((v, i) => v === prev[i])
              ? prev
              : merged;
          });
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serial]);

  // 副屏(客显)放上面,主屏放下面 — 收银员盯着主屏操作,顺序按需求固定。
  const orderedDisplays = [...displays].sort(
    (a, b) => (a === 0 ? 1 : 0) - (b === 0 ? 1 : 0),
  );

  // Native resolution per display, reported once each stream's first frame
  // arrives — used to pick whichever arrangement wastes less panel space.
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>(
    {},
  );
  const onSizeFns = useRef(new Map<number, (w: number, h: number) => void>());
  function onSizeFor(did: number) {
    let fn = onSizeFns.current.get(did);
    if (!fn) {
      fn = (w, h) => {
        setSizes((prev) => {
          const cur = prev[did];
          if (cur && cur.w === w && cur.h === h) return prev;
          return { ...prev, [did]: { w, h } };
        });
      };
      onSizeFns.current.set(did, fn);
    }
    return fn;
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pick whichever arrangement renders more total video pixels: stacked
  // (default) wastes width when screens are landscape+wide; side-by-side
  // wastes height when the panel itself is short. Neither is always right,
  // so measure both against the real panel size + real screen resolutions.
  let orientation: "row" | "col" = "col";
  const n = orderedDisplays.length;
  if (n > 1 && box.w > 0 && box.h > 0) {
    const ratios = orderedDisplays.map((did) => {
      const s = sizes[did];
      return s && s.h > 0 ? s.w / s.h : 16 / 9;
    });
    const rowH = Math.max(box.h - CHROME_PX, 1);
    const rowTotal = ratios.reduce(
      (sum, r) => sum + fitArea(box.w / n, rowH, r),
      0,
    );
    const colH = Math.max(box.h / n - CHROME_PX, 1);
    const colTotal = ratios.reduce(
      (sum, r) => sum + fitArea(box.w, colH, r),
      0,
    );
    orientation = rowTotal > colTotal ? "row" : "col";
  }

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 flex min-h-0 ${orientation === "row" ? "flex-row" : "flex-col"}${visible ? "" : " invisible pointer-events-none"}`}
    >
      {orderedDisplays.map((did) => (
        <div
          key={did}
          className={
            orientation === "row"
              ? "min-w-0 flex-1 border-r border-border last:border-r-0"
              : "min-h-0 flex-1 border-b border-border last:border-b-0"
          }
        >
          <ScreenMirror
            serial={serial}
            displayId={did}
            showBackButton={did === 0}
            onSize={onSizeFor(did)}
            label={
              displays.length > 1
                ? did === 0
                  ? "主屏"
                  : `副屏 (display ${did})`
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
