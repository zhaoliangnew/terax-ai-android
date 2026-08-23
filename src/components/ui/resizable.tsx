import * as ResizablePrimitive from "react-resizable-panels"

import { getAppZoom } from "@/lib/appZoom"
import { cn } from "@/lib/utils"

/**
 * UI 缩放不等于 100% 时,分隔条要往右(或往下)偏一截才拖得动 —— 这里把它掰回来。
 *
 * 整个界面套在 `.zoom-content { zoom: var(--app-zoom) }` 里。这个 WebKit 上
 * `getBoundingClientRect()` 返回的是**没算缩放**的布局坐标,而鼠标事件的
 * `clientX` 是**算过缩放**的视觉坐标,两套值差一个 zoom 倍数。平时没人在意,
 * 因为浏览器自己的命中判定是自洽的;但 react-resizable-panels 是拿
 * `clientX` 去比 `getBoundingClientRect()` 的结果、自己判断有没有点到分隔条的,
 * 两边一错位就废了。
 *
 * 实测(zoom=0.95):分隔条 rect 报 [358.2, 362.4],鼠标真正要落在 [332, 346],
 * 差 `x × (1 - zoom) ≈ 18px`,而且越往右差得越多 —— 所以是"要偏右一点",
 * 且第二条分隔条比第一条更偏。
 *
 * 修法:给库会去量的那几个元素(group / panel / separator)把
 * `getBoundingClientRect` 包一层,乘上 zoom 换算成视觉坐标,跟 `clientX` 对齐。
 * 只有这三类元素被改,它们的子树(终端、编辑器那些自己量尺寸的)一律不受影响。
 *
 * 顺带说明:比例是缩放无关的,所以库算出来的百分比布局仍然是对的;px 形式的
 * min/max 约束会跟着差一个 zoom 倍数,几个像素,无所谓。
 */
function zoomAwareRect(el: HTMLElement | null): void {
  if (!el) return
  const patched = el as HTMLElement & { __zoomRectPatched?: boolean }
  if (patched.__zoomRectPatched) return
  patched.__zoomRectPatched = true
  const original = el.getBoundingClientRect.bind(el)
  el.getBoundingClientRect = () => {
    const z = getAppZoom()
    const r = original()
    return z === 1
      ? r
      : new DOMRect(r.x * z, r.y * z, r.width * z, r.height * z)
  }
}

/**
 * 能不能拖,由这个值说了算,不是 handle 的 CSS 宽度。
 *
 * 库自己做命中判定:取分隔条的矩形,不够 `resizeTargetMinimumSize` 就以它为中心
 * 撑到这么宽,鼠标落在这个矩形里才算数。handle 上的 `after:w-*` 只影响 hover
 * 高亮和光标形状 —— 两边对不上就会出现"光标变成了左右箭头,却拖不动"。
 *
 * 库默认 fine 只有 10px,分隔条本身才 4px,太苛刻了;这里抬到 20px,并把各处
 * handle 的 `after:w-5` 对齐成同样的 20px。
 */
const RESIZE_TARGET = { coarse: 28, fine: 20 }

function ResizablePanelGroup({
  className,
  elementRef,
  resizeTargetMinimumSize = RESIZE_TARGET,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      elementRef={(el) => {
        zoomAwareRect(el)
        if (typeof elementRef === "function") elementRef(el)
        else if (elementRef) elementRef.current = el
      }}
      resizeTargetMinimumSize={resizeTargetMinimumSize}
      {...props}
    />
  )
}

function ResizablePanel({ elementRef, ...props }: ResizablePrimitive.PanelProps) {
  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      elementRef={(el) => {
        zoomAwareRect(el)
        if (typeof elementRef === "function") elementRef(el)
        else if (elementRef) elementRef.current = el
      }}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  elementRef,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      elementRef={(el) => {
        zoomAwareRect(el)
        if (typeof elementRef === "function") elementRef(el)
        else if (elementRef) elementRef.current = el
      }}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
