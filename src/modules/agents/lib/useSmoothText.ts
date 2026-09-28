import { useEffect, useRef, useState } from "react";

/** 每帧放出积压部分的这么多分之一:积压多就放得快,追上来就慢下来。 */
const CATCH_UP_FRAMES = 10;

/**
 * 流式回复逐字放出来。模型的输出是一段一段到的(网络一包几十上百字),
 * 直接显示就是一块一块往外蹦;这里按帧匀速补上,看起来是连续的。
 * 一开始就是完整文字的(历史消息)不做动画。
 */
export function useSmoothText(target: string, streaming: boolean): string {
  const [len, setLen] = useState(streaming ? 0 : target.length);
  const lenRef = useRef(len);
  const targetRef = useRef(target);
  targetRef.current = target;
  const rafRef = useRef(0);

  useEffect(() => {
    if (rafRef.current || lenRef.current >= target.length) return;
    const tick = () => {
      const backlog = targetRef.current.length - lenRef.current;
      if (backlog <= 0) {
        rafRef.current = 0;
        return;
      }
      lenRef.current += Math.max(1, Math.ceil(backlog / CATCH_UP_FRAMES));
      setLen(lenRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  return len >= target.length ? target : target.slice(0, len);
}
