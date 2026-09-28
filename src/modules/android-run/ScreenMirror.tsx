import { useAgentViewStore } from "@/modules/agents/store/agentViewStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CODE_TO_AKEYCODE } from "./lib/keymap";
import {
  annotationText,
  captureAnnotated,
  cropThumb,
  letterbox,
  type Mark,
  useMirrorAnnotate,
} from "./lib/mirrorAnnotate";
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
  const toFrameXY = useCallback((e: React.PointerEvent, clamp: boolean) => {
    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || w === 0 || h === 0) return null;
    // 全程用 canvas 自己的坐标系:clientWidth/Height 和 offsetX/Y 都是相对
    // 这个元素的,界面缩放(`zoom`)怎么变都一致。别混 getBoundingClientRect
    // 和 clientX —— 这个 WebKit 上前者是布局坐标、后者是视觉坐标,zoom 不等于
    // 100% 时两者差一个倍数,点哪儿都会偏(面板分隔条就栽在这上面)。
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    if (boxW === 0 || boxH === 0) return null;
    const boxRatio = boxW / boxH;
    const frameRatio = w / h;
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
    let px = e.nativeEvent.offsetX - offX;
    let py = e.nativeEvent.offsetY - offY;
    if (!clamp && (px < 0 || py < 0 || px > drawW || py > drawH)) {
      return null; // pressed the letterbox bar
    }
    px = Math.max(0, Math.min(drawW, px));
    py = Math.max(0, Math.min(drawH, py));
    return {
      x: Math.max(0, Math.min(w - 1, (px / drawW) * w)),
      y: Math.max(0, Math.min(h - 1, (py / drawH) * h)),
    };
  }, []);

  const downRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

  // 批注模式(照 Codex):在画面上点一下,当场弹个小框写一句,连同带编号
  // 的截图发进当前聊天窗格。开关在 DevicePanel 的设备名那行,只主屏参与。
  // 打开时上面盖一层,触摸不会传给设备。
  const annotating =
    useMirrorAnnotate((s) => s.serial === serial) && displayId === 0;
  const closeStore = useMirrorAnnotate((s) => s.close);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const markId = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // 点完就把光标落到刚弹出的小框里,不用再点一下。等 DOM 出来再聚焦。
  useEffect(() => {
    if (editingId == null) return;
    const t = requestAnimationFrame(() => editRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [editingId]);

  // 记下批注层的实际尺寸,好把百分比位置换算成屏上像素(视频有黑边留白)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !annotating) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [annotating]);

  const lb = letterbox(box.w, box.h, sizeRef.current.w, sizeRef.current.h);
  const markXY = (m: Mark) => ({
    left: lb.offX + m.xPct * lb.drawW,
    top: lb.offY + m.yPct * lb.drawH,
  });

  const closeAnnotate = () => {
    closeStore();
    setMarks([]);
    setEditingId(null);
    setListOpen(false);
  };

  // 关掉批注(比如切了设备)时把没发的标注清掉
  useEffect(() => {
    if (annotating) return;
    setMarks([]);
    setEditingId(null);
    setListOpen(false);
  }, [annotating]);

  // 空说明的标注不留:关掉编辑器时顺手清掉没写字的那条
  const dropEmpty = (id: number) =>
    setMarks((cur) => cur.filter((m) => m.id !== id || m.note.trim() !== ""));

  const addMark = (e: React.PointerEvent) => {
    // 正在写某条:这一下是"写完点别处",收起编辑器,不新增
    if (editingId != null) {
      dropEmpty(editingId);
      setEditingId(null);
      return;
    }
    const { w, h } = sizeRef.current;
    const canvas = canvasRef.current;
    if (w === 0 || h === 0 || !canvas) return;
    const px = e.nativeEvent.offsetX - lb.offX;
    const py = e.nativeEvent.offsetY - lb.offY;
    if (px < 0 || py < 0 || px > lb.drawW || py > lb.drawH) return; // 点到黑边
    const xPct = px / lb.drawW;
    const yPct = py / lb.drawH;
    markId.current += 1;
    const id = markId.current;
    setMarks((cur) => [
      ...cur,
      { id, xPct, yPct, note: "", thumb: cropThumb(canvas, xPct, yPct) },
    ]);
    setEditingId(id);
  };

  const setNote = (id: number, note: string) =>
    setMarks((cur) => cur.map((m) => (m.id === id ? { ...m, note } : m)));

  const removeMark = (id: number) => {
    setMarks((cur) => cur.filter((m) => m.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const sendMarks = async () => {
    const canvas = canvasRef.current;
    const kept = marks.filter((m) => m.note.trim() !== "");
    if (!canvas || kept.length === 0) {
      toast.error("先在画面上点一下,写句说明");
      return;
    }
    const leafId = useAgentViewStore.getState().activeChatLeaf;
    if (leafId == null) {
      toast.error("先在左边的窗格切到聊天,再发批注");
      return;
    }
    setSending(true);
    try {
      const path = await captureAnnotated(canvas, kept);
      useAgentViewStore.getState().injectToChat(
        leafId,
        annotationText(kept),
        [path],
        kept.map((m) => ({ thumb: m.thumb, note: m.note })),
      );
      closeAnnotate();
      toast.success("批注已加到对话");
    } catch (err) {
      toast.error(`发送失败:${String(err)}`);
    } finally {
      setSending(false);
    }
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
        {/* 批注层:盖在 canvas 上,点一下落一个编号点并当场弹框写说明 */}
        {annotating && (
          <div
            ref={overlayRef}
            onPointerDown={addMark}
            className="absolute inset-0 z-10 cursor-crosshair"
          >
            {marks.map((m, i) => {
              const pos = markXY(m);
              return (
                <span key={m.id}>
                  <span
                    className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute flex size-5 items-center justify-center rounded-full border border-white bg-[#2c67c5] text-[11px] text-white shadow"
                    style={pos}
                  >
                    {i + 1}
                  </span>
                  {/* 写说明的小框:照 Codex 就贴在点旁边,深色胶囊。
                      ⏎ 加到列表接着标,⌘⏎ 直接发到对话 */}
                  {editingId === m.id && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      className="-translate-y-1/2 absolute z-30 translate-x-3"
                      style={{ left: pos.left, top: pos.top }}
                    >
                      <div className="flex items-center gap-2 rounded-full bg-[#2b2b2b] py-1.5 pr-1.5 pl-3 shadow-xl">
                        <input
                          ref={editRef}
                          value={m.note}
                          onChange={(e) => setNote(m.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              dropEmpty(m.id);
                              setEditingId(null);
                              void sendMarks();
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              dropEmpty(m.id);
                              setEditingId(null);
                            } else if (e.key === "Escape") {
                              removeMark(m.id);
                            }
                          }}
                          placeholder="添加评论"
                          className="w-40 bg-transparent text-[12.5px] text-white outline-none placeholder:text-white/40"
                        />
                        <button
                          type="button"
                          aria-label="添加到列表"
                          onClick={() => {
                            dropEmpty(m.id);
                            setEditingId(null);
                          }}
                          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                        >
                          ↑
                        </button>
                      </div>
                      {/* 两个动作:加到列表 / 直接发对话(照 Codex) */}
                      {m.note.trim() !== "" && (
                        <div className="absolute top-0 left-full ml-2 flex flex-col gap-0.5 whitespace-nowrap rounded-lg bg-[#2b2b2b] p-1 text-[12px] text-white shadow-xl">
                          <button
                            type="button"
                            onClick={() => {
                              dropEmpty(m.id);
                              setEditingId(null);
                            }}
                            className="flex cursor-pointer items-center gap-3 rounded px-2 py-1 hover:bg-white/10"
                          >
                            添加
                            <span className="text-white/45">⏎</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              dropEmpty(m.id);
                              setEditingId(null);
                              void sendMarks();
                            }}
                            className="flex cursor-pointer items-center gap-3 rounded px-2 py-1 hover:bg-white/10"
                          >
                            发送
                            <span className="text-white/45">⌘⏎</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {/* 批注中浮条(照 Codex):条数、列表、发送、退出 */}
        {annotating && (
          <div className="-translate-x-1/2 absolute bottom-3 left-1/2 z-30 flex items-center gap-1 rounded-full bg-[#2b2b2b] px-2 py-1 text-white shadow-xl">
            <span className="relative">
              <button
                type="button"
                onClick={() => setListOpen((v) => !v)}
                disabled={marks.length === 0}
                className="cursor-pointer rounded-full px-2 py-1 text-[12px] hover:bg-white/10 disabled:opacity-50"
              >
                批注中 · {marks.length}
              </button>
              {/* 批注卡片列表:小图 + 说明 + 编辑/删除 */}
              {listOpen && marks.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 flex w-64 flex-col gap-1 rounded-xl bg-[#2b2b2b] p-1.5 shadow-xl">
                  {marks.map((m, i) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.06]"
                    >
                      {m.thumb ? (
                        <img
                          src={m.thumb}
                          alt=""
                          className="size-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-white/10 text-[11px]">
                          {i + 1}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-white/90">
                        {m.note.trim() || "(未写说明)"}
                      </span>
                      <button
                        type="button"
                        aria-label="编辑"
                        onClick={() => {
                          setEditingId(m.id);
                          setListOpen(false);
                        }}
                        className="shrink-0 cursor-pointer rounded px-1 text-white/60 hover:text-white"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        aria-label="删除"
                        onClick={() => removeMark(m.id)}
                        className="shrink-0 cursor-pointer rounded px-1 text-white/60 hover:text-white"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </span>
            <button
              type="button"
              disabled={sending || marks.every((m) => m.note.trim() === "")}
              onClick={() => void sendMarks()}
              className="cursor-pointer rounded-full bg-[#2c67c5] px-3 py-1 text-[12px] hover:bg-[#3572d4] disabled:opacity-45"
            >
              {sending ? "发送中…" : "发送"}
            </button>
            <button
              type="button"
              aria-label="退出批注"
              onClick={closeAnnotate}
              className="flex size-6 cursor-pointer items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
            >
              ×
            </button>
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
