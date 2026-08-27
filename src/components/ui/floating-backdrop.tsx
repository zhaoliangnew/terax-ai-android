import { createPortal } from "react-dom";

/**
 * 浮层外面那层淡淡的磨砂底。浮层自己的底色不动。
 *
 * 用法:放在浮层内容里当第一个子元素,它会自己 `createPortal` 到 body 上 ——
 * 两个坑都得绕开:
 *  - 直接写在浮层内容里不行:Radix 给浮层套的定位容器带 `transform`,里面的
 *    `position: fixed` 会以那个容器为基准,`inset-0` 正好等于浮层自己那块,
 *    结果整个弹框被蒙上一层灰,外面反倒什么都没有。
 *  - 放进 Radix 的 Portal 里当兄弟节点也不行:Portal 内部是 `Primitive.div
 *    asChild`,只接一个子元素,多给一个直接 "failed to slot onto its children"。
 *
 * z-40 压在浮层(z-50)下面、界面上面 —— Radix 会把浮层内容的 z-index 抄到它
 * 那个定位容器上,所以这个层级关系是稳的。
 *
 * `pointer-events-none`:只管视觉,不接事件。点外面照样按原来的规则关掉浮层,
 * 不会变成"要先点一下蒙层"。
 */
export function FloatingBackdrop() {
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 animate-in bg-black/25 fade-in-0 duration-100 supports-backdrop-filter:backdrop-blur-[2px]"
    />,
    document.body,
  );
}
