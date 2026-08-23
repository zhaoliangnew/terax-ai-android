import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * 能不能拖,由这个值说了算,不是 handle 的 CSS 宽度。
 *
 * react-resizable-panels 自己做命中判定:取两块面板之间的空隙,不够
 * `resizeTargetMinimumSize` 就以空隙为中心撑到这么宽,鼠标落在这个矩形里才
 * 算拖分隔条。handle 上的 `after:w-*` 只影响 hover 高亮和光标形状 —— 两边对
 * 不上就会出现"光标变成了左右箭头,却拖不动"这种见鬼的事。
 *
 * 库的默认值 fine 只有 10px,分隔条本身 4px,两侧面板各还有 2px 内边距,
 * 于是肉眼看到的那条缝比能拖的地方还宽。这里抬到 20px,并把各处 handle 的
 * `after:w-5` 对齐成同样的 20px。
 */
const RESIZE_TARGET = { coarse: 28, fine: 20 }

function ResizablePanelGroup({
  className,
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
      resizeTargetMinimumSize={resizeTargetMinimumSize}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
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
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
