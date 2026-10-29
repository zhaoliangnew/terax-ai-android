import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { type TypingEffect, useTypingEffect } from "../lib/chatFontScale";

/**
 * 输入框打字效果。系统输入框没法给单个字加动画,所以叠一层显示层:输入框
 * 文字设成透明(光标、选中照常),字由这层画出来,新打的那几个字带动画。
 * 输入法组字时不动画(拼音一直在变),字上屏后才动。
 */
/** 打字的"咔哒"声:合成一小段过滤过的噪声,不用音频文件。 */
let audio: AudioContext | null = null;
function playClick() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const len = Math.floor(ctx.sampleRate * 0.025);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400 + Math.random() * 800;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    // 没有声音设备就算了
  }
}

export function useTypingFx(text: string, composing: boolean) {
  const effect = useTypingEffect((s) => s.effect);
  const prev = useRef(text);
  const [fresh, setFresh] = useState<{ start: number; end: number; n: number }>(
    { start: 0, end: 0, n: 0 },
  );
  useEffect(() => {
    // 组字中(打拼音)不记:等字上屏后拿组字前的文本比,才认得出上屏的那几个字
    if (composing) return;
    const before = prev.current;
    prev.current = text;
    if (effect === "off") return;
    // 新旧文本的公共前缀、后缀之间就是这次插进来的字
    let p = 0;
    while (p < before.length && p < text.length && before[p] === text[p]) p++;
    let q = 0;
    while (
      q < before.length - p &&
      q < text.length - p &&
      before[before.length - 1 - q] === text[text.length - 1 - q]
    )
      q++;
    const end = text.length - q;
    // 粘贴一大段不动画,只动手打的(一次上屏一个词组也算)
    if (end > p && end - p <= 20) {
      setFresh((f) => ({ start: p, end, n: f.n + 1 }));
      if (useTypingEffect.getState().sound) playClick();
    }
  }, [text, composing, effect]);
  return { effect, fresh };
}

export function TypingMirror({
  text,
  effect,
  fresh,
  scrollTop,
  className,
}: {
  text: string;
  effect: TypingEffect;
  fresh: { start: number; end: number; n: number };
  scrollTop: number;
  /** 和输入框完全一样的字号、行高、内边距,字才能一个个对上。 */
  className?: string;
}) {
  const start = Math.min(fresh.start, text.length);
  const end = Math.min(fresh.end, text.length);
  const anim = effect === "off" ? undefined : `terax-type-${effect}`;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-foreground",
        className,
      )}
    >
      <div style={{ transform: `translateY(${-scrollTop}px)` }}>
        {text.slice(0, start)}
        {/* key 跟着每次插入变,同样的字再打一遍动画也会重放 */}
        {[...text.slice(start, end)].map((ch, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 位置就是身份,每次插入换一批
            key={`${fresh.n}-${i}`}
            className={ch === "\n" ? undefined : anim}
            // 彩虹:每个字一个色相,连着打的字颜色不重样
            style={
              effect === "rainbow"
                ? ({
                    "--terax-hue": (fresh.n * 47 + i * 71) % 360,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {ch}
          </span>
        ))}
        {text.slice(end)}
        {/* 最后是换行时撑出那一行的高度 */}
        {"​"}
      </div>
    </div>
  );
}
