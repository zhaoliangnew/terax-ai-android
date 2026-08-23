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
}

export function getAppZoom(): number {
  return current;
}
