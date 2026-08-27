import { useEffect, useState } from "react";

/** 上膛后多久自动松开。够看清按钮变成"再点一次确认"、够手指移过去点第二下,
 * 又短到不会让一个红按钮一直在那儿等着误触。 */
const DEFAULT_DISARM_MS = 4000;

/**
 * 两步确认的"上膛"状态:第一次点只是把按钮变成"再点一次确认…",
 * 第二次点才真执行。
 *
 * 光靠 onBlur 松开是不够的 —— 鼠标不点别处、也不切焦点的话,那个红按钮
 * 会一直armed 挂着,过一会儿人忘了自己点过,下一次点就直接执行了。所以
 * 这里统一加超时自动松开。
 *
 * 泛型 T 就是"armed 的是哪一个"(文件、路径…);不需要区分对象时用
 * `useArmedConfirm<true>()`,`null` 表示没上膛。
 */
export function useArmedConfirm<T>(timeoutMs: number = DEFAULT_DISARM_MS) {
  const [armed, setArmed] = useState<T | null>(null);

  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [armed, timeoutMs]);

  return [armed, setArmed] as const;
}
