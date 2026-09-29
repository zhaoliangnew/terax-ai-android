import { useRef } from "react";

/**
 * 输入法组字时按下的键不能当成快捷键(尤其是回车 = 发送)。
 *
 * 光看 `isComposing` 不够:WebKit(Safari / WKWebView,我们的界面就跑在它上面)
 * 里,用拼音输入法按回车把字母直接上屏时,compositionend 比这次 keydown 先到,
 * keydown 里 isComposing 已经是 false —— 只剩 keyCode 229 能认出来;保险起见再
 * 挡一下"刚结束组字"那一瞬间来的键。终端那边(rendererPool)也是靠 229 认的。
 */
export function useImeGuard() {
  const composing = useRef(false);
  const endedAt = useRef(0);
  return {
    /** 挂到输入框上。 */
    imeProps: {
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: () => {
        composing.current = false;
        endedAt.current = performance.now();
      },
    },
    /** 这个键是不是输入法在用(是的话别当快捷键处理)。 */
    isImeKey: (e: React.KeyboardEvent) =>
      composing.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      performance.now() - endedAt.current < 50,
  };
}
