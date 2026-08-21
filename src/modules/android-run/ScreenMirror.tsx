import { useCallback, useEffect, useRef, useState } from "react";
import { CODE_TO_AKEYCODE, MODIFIER_AKEYCODES } from "./lib/keymap";
import {
  KEY_ACTION_DOWN,
  KEY_ACTION_UP,
  KEY_APP_SWITCH,
  KEY_BACK,
  KEY_HOME,
  META_ALT_ON,
  META_CTRL_ON,
  META_META_ON,
  META_SHIFT_ON,
  scrcpyKey,
  scrcpyKeyEvent,
  scrcpyStart,
  scrcpyStop,
  scrcpyTouch,
  TOUCH_DOWN,
  TOUCH_MOVE,
  TOUCH_UP,
  type VideoEvent,
} from "./lib/scrcpy";

const MODIFIER_META_BIT: Record<number, number> = {
  59: META_SHIFT_ON, // ShiftLeft
  60: META_SHIFT_ON, // ShiftRight
  113: META_CTRL_ON, // ControlLeft
  114: META_CTRL_ON, // ControlRight
  57: META_ALT_ON, // AltLeft
  58: META_ALT_ON, // AltRight
  117: META_META_ON, // MetaLeft
  118: META_META_ON, // MetaRight
};

type Props = {
  serial: string;
  displayId?: number;
  label?: string;
  /** Secondary/customer-facing displays have no back-stack — hide 返回. */
  showBackButton?: boolean;
  /** Reports the device's native frame size once known (for layout decisions). */
  onSize?: (w: number, h: number) => void;
};

type Status = "connecting" | "streaming" | "error" | "ended";

/**
 * Feeds Annex-B H.264 from the scrcpy session into a WebCodecs VideoDecoder and
 * paints frames to a canvas. Draws on the decoder output callback and closes
 * each VideoFrame immediately to avoid decode-queue backpressure.
 */
export function ScreenMirror({
  serial,
  displayId = 0,
  label,
  showBackButton = true,
  onSize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const decoderRef = useRef<VideoDecoder | null>(null);
  const configuredRef = useRef(false);
  const configBytesRef = useRef<Uint8Array | null>(null);
  // True while resyncing after a dropped frame: delta frames reference prior
  // frames, so decoding one whose predecessor was dropped corrupts output
  // (visible as ghosting/smearing) until the next self-contained keyframe.
  const resyncingRef = useRef(false);

  const draw = useCallback((frame: VideoFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      frame.close();
      return;
    }
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(frame, 0, 0);
    frame.close();
  }, []);

  const ensureDecoder = useCallback(() => {
    if (decoderRef.current) return decoderRef.current;
    if (typeof VideoDecoder === "undefined") {
      setStatus("error");
      setError("此 WebView 不支持 WebCodecs 视频解码");
      return null;
    }
    const decoder = new VideoDecoder({
      output: (frame) => draw(frame),
      error: (e) => {
        setStatus("error");
        setError(`解码错误: ${e.message}`);
      },
    });
    decoderRef.current = decoder;
    return decoder;
  }, [draw]);

  const onEvent = useCallback(
    (e: VideoEvent) => {
      if (e.kind === "size") {
        sizeRef.current = { w: e.width, h: e.height };
        onSize?.(e.width, e.height);
        // Reconfigure decoder for the new resolution on the next config packet.
        configuredRef.current = false;
        return;
      }
      if (e.kind === "error") {
        setStatus("error");
        setError(e.message);
        return;
      }
      if (e.kind === "ended") {
        setStatus("ended");
        return;
      }
      // meta + payload
      const decoder = ensureDecoder();
      if (!decoder) return;

      if (e.config) {
        // SPS/PPS — configure decoder, remember bytes to prepend to next frame.
        configBytesRef.current = e.payload;
        const { w, h } = sizeRef.current;
        try {
          decoder.configure({
            codec: "avc1.42e01f", // baseline; description-less Annex-B
            codedWidth: w || undefined,
            codedHeight: h || undefined,
            optimizeForLatency: true,
          });
          configuredRef.current = true;
          setStatus("streaming");
        } catch (err) {
          setStatus("error");
          setError(`配置解码器失败: ${String(err)}`);
        }
        return;
      }

      if (!configuredRef.current) return; // wait for first config
      // Prepend stored config to the first frame after (re)configure — an
      // Annex-B decoder accepts config+frame concatenated.
      let data = e.payload;
      if (configBytesRef.current) {
        const merged = new Uint8Array(
          configBytesRef.current.length + e.payload.length,
        );
        merged.set(configBytesRef.current, 0);
        merged.set(e.payload, configBytesRef.current.length);
        data = merged;
        configBytesRef.current = null;
      }
      if (e.keyFrame) {
        resyncingRef.current = false;
      } else if (resyncingRef.current || decoder.decodeQueueSize > 4) {
        // Stay real-time by dropping delta frames once we're behind, but a
        // dropped frame breaks the reference chain for every delta frame
        // after it — keep dropping until the next keyframe resyncs cleanly,
        // instead of feeding the decoder a frame missing its reference.
        resyncingRef.current = true;
        return;
      }
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: e.keyFrame ? "key" : "delta",
            timestamp: e.pts,
            data,
          }),
        );
      } catch {
        // decoder in a bad state; will surface via error callback
      }
    },
    [ensureDecoder, onSize],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");
    setError(null);
    configuredRef.current = false;
    configBytesRef.current = null;
    resyncingRef.current = false;
    scrcpyStart(serial, 1600, displayId, onEvent)
      .then((id) => {
        if (cancelled) {
          void scrcpyStop(id);
          return;
        }
        sessionIdRef.current = id;
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus("error");
          setError(String(err));
        }
      });
    return () => {
      cancelled = true;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id != null) void scrcpyStop(id);
      if (decoderRef.current) {
        try {
          decoderRef.current.close();
        } catch {
          // already closed
        }
        decoderRef.current = null;
      }
    };
  }, [serial, displayId, onEvent]);

  // Map a canvas pointer event to video-frame coordinates. The canvas now
  // fills its panel via `object-contain`, which letterboxes (adds blank
  // bars) when the panel's aspect ratio doesn't match the device screen's —
  // account for that inset instead of assuming the box IS the video.
  // `clamp: true` (move/up) keeps a drag alive when the pointer strays a bit
  // past the video edge into the letterbox — dropping those events instead
  // breaks Android's fling/scroll gesture recognition mid-swipe. `clamp:
  // false` (down) still rejects a press that starts in the letterbox.
  const toFrameXY = useCallback(
    (e: React.PointerEvent, clamp: boolean) => {
      const canvas = canvasRef.current;
      const { w, h } = sizeRef.current;
      if (!canvas || w === 0 || h === 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const boxRatio = rect.width / rect.height;
      const frameRatio = w / h;
      let drawW = rect.width;
      let drawH = rect.height;
      let offX = 0;
      let offY = 0;
      if (boxRatio > frameRatio) {
        drawW = rect.height * frameRatio;
        offX = (rect.width - drawW) / 2;
      } else {
        drawH = rect.width / frameRatio;
        offY = (rect.height - drawH) / 2;
      }
      let px = e.clientX - rect.left - offX;
      let py = e.clientY - rect.top - offY;
      if (!clamp && (px < 0 || py < 0 || px > drawW || py > drawH)) {
        return null; // pressed the letterbox bar
      }
      px = Math.max(0, Math.min(drawW, px));
      py = Math.max(0, Math.min(drawH, py));
      return {
        x: Math.max(0, Math.min(w - 1, (px / drawW) * w)),
        y: Math.max(0, Math.min(h - 1, (py / drawH) * h)),
      };
    },
    [],
  );

  const downRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.focus();
    // Mouse "back" side button — map to Android BACK instead of a touch.
    if (e.button === 3) {
      e.preventDefault();
      const id = sessionIdRef.current;
      if (id != null) void scrcpyKey(id, KEY_BACK);
      return;
    }
    if (e.button !== 0) return; // right-click/forward etc. aren't a touch
    const id = sessionIdRef.current;
    const p = toFrameXY(e, false);
    if (id == null || !p) return;
    downRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    void scrcpyTouch(id, TOUCH_DOWN, p.x, p.y, 1.0);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!downRef.current) return;
    const id = sessionIdRef.current;
    const p = toFrameXY(e, true);
    if (id == null || !p) return;
    void scrcpyTouch(id, TOUCH_MOVE, p.x, p.y, 1.0);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!downRef.current) return;
    downRef.current = false;
    const id = sessionIdRef.current;
    const p = toFrameXY(e, true);
    if (id == null || !p) return;
    void scrcpyTouch(id, TOUCH_UP, p.x, p.y, 0.0);
  };

  const navKey = (keycode: number) => {
    const id = sessionIdRef.current;
    if (id != null) void scrcpyKey(id, keycode);
  };

  // Forwards the physical keyboard to the device while the mirror is
  // focused — down/up events with live metaState (not the nav buttons'
  // fixed down+up pair), so held keys, repeat, and shifted symbols work.
  const metaStateRef = useRef(0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const id = sessionIdRef.current;
    const akeycode = CODE_TO_AKEYCODE[e.code];
    if (id == null || akeycode === undefined) return;
    e.preventDefault();
    const bit = MODIFIER_META_BIT[akeycode];
    if (bit) metaStateRef.current |= bit;
    void scrcpyKeyEvent(id, akeycode, KEY_ACTION_DOWN, metaStateRef.current);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    const id = sessionIdRef.current;
    const akeycode = CODE_TO_AKEYCODE[e.code];
    if (id == null || akeycode === undefined) return;
    e.preventDefault();
    void scrcpyKeyEvent(id, akeycode, KEY_ACTION_UP, metaStateRef.current);
    const bit = MODIFIER_META_BIT[akeycode];
    if (bit) metaStateRef.current &= ~bit;
  };

  return (
    <div className="zoom-exempt flex h-full min-h-0 flex-col">
      {label && (
        <div className="shrink-0 border-b border-border px-2 py-0.5 text-center text-[10px] text-muted-foreground">
          {label}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="h-full w-full touch-none object-contain outline-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
        {status !== "streaming" && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
            {status === "connecting" && "连接投屏中…"}
            {status === "error" && (
              <span className="max-w-[80%] text-center text-red-400">
                {error ?? "投屏失败"}
              </span>
            )}
            {status === "ended" && "投屏已结束"}
          </div>
        )}
      </div>
      {/* nav bar */}
      <div className="flex shrink-0 items-center justify-center gap-6 border-t border-border py-1.5">
        {showBackButton && (
          <button
            type="button"
            onClick={() => navKey(KEY_BACK)}
            className="text-muted-foreground hover:text-foreground"
            title="返回"
          >
            ◁
          </button>
        )}
        <button
          type="button"
          onClick={() => navKey(KEY_HOME)}
          className="text-muted-foreground hover:text-foreground"
          title="主屏"
        >
          ○
        </button>
        <button
          type="button"
          onClick={() => navKey(KEY_APP_SWITCH)}
          className="text-muted-foreground hover:text-foreground"
          title="最近任务"
        >
          ▢
        </button>
      </div>
    </div>
  );
}
