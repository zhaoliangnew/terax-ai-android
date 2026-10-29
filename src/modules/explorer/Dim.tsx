import { createPortal } from "react-dom";

/**
 * 弹层打开时把后面整个界面压暗(不模糊,字照样看得清),弹层保持原亮度浮在
 * 上面,一眼分得开。不拦鼠标:左栏照样能停、能换目录,点外面照样能关。
 */
export function Dim({ zIndex = 40 }: { zIndex?: number }) {
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 bg-black/40"
      style={{ zIndex }}
    />,
    document.body,
  );
}
