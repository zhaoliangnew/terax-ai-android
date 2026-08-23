/**
 * 当前 UI 缩放倍数(`--app-zoom`)的一份内存副本。
 *
 * 值本身存在 preferences 里、以 CSS 变量的形式作用到 DOM 上;这里再留一份是
 * 因为有些地方(比如面板分隔条的命中判定)要在 pointermove 里每帧读它,
 * 走 getComputedStyle 太贵。
 */
let current = 1;

export function setAppZoom(z: number): void {
  current = z > 0 ? z : 1;
  probed = null; // 换了缩放要重新量一次
}

export function getAppZoom(): number {
  return current;
}

let probed: { zoom: number; scale: number } | null = null;

/**
 * `getBoundingClientRect()` 的结果要乘多少才等于鼠标事件那套坐标。
 *
 * 背景:整个界面套在 `.zoom-content { zoom: var(--app-zoom) }` 里。按 CSS Zoom
 * 规范,gBCR 返回的应该是算过缩放的视觉坐标 —— Chromium(Windows 的 WebView2)
 * 就是这么做的。但 macOS 这版 WKWebView 返回的是**没算缩放**的布局坐标,而
 * `clientX` 始终是视觉坐标,两者差一个 zoom 倍数。
 *
 * 所以不能按平台写死,也不能无脑乘 —— 在 Chromium 上乘就是乘重了,分隔条反而
 * 更拖不动。这里插一个宽 100px 的探针实测一下:量出来 100 说明是布局坐标(要
 * 乘 zoom),量出来 100×zoom 说明已经是视觉坐标(乘 1)。
 *
 * 只在 zoom≠1 时才量,结果按 zoom 缓存。
 */
export function rectToVisualScale(): number {
  const z = current;
  if (z === 1) return 1;
  if (probed && probed.zoom === z) return probed.scale;
  let scale = 1;
  const host = document.querySelector(".zoom-content");
  if (host) {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;left:0;top:0;width:100px;height:0;visibility:hidden;pointer-events:none";
    host.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    scale = Math.abs(w - 100) <= Math.abs(w - 100 * z) ? z : 1;
  }
  probed = { zoom: z, scale };
  return scale;
}
