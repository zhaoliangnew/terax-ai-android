import { create } from "zustand";

/** 切项目时中间区域的过渡动画,在顶部"效果"下拉里选,记在本地。 */
export type SwitchAnimation = "none" | "fade" | "slide" | "zoom";

export const SWITCH_ANIMATIONS: { value: SwitchAnimation; label: string }[] = [
  { value: "none", label: "无" },
  { value: "fade", label: "淡入淡出" },
  { value: "slide", label: "滑动" },
  { value: "zoom", label: "缩放" },
];

const KEY = "terax.ui.switchAnimation";

function load(): SwitchAnimation {
  try {
    const v = localStorage.getItem(KEY);
    return SWITCH_ANIMATIONS.some((a) => a.value === v)
      ? (v as SwitchAnimation)
      : "fade";
  } catch {
    return "fade";
  }
}

export const useSwitchAnimation = create<{
  anim: SwitchAnimation;
  set: (a: SwitchAnimation) => void;
}>((set) => ({
  anim: load(),
  set: (anim) => {
    try {
      localStorage.setItem(KEY, anim);
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ anim });
  },
}));

/** 一层(某个项目的界面)在显示 / 隐藏两种状态下的样式。 */
export function switchLayerStyle(
  anim: SwitchAnimation,
  shown: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    visibility: shown ? "visible" : "hidden",
    pointerEvents: shown ? "auto" : "none",
  };
  if (anim === "none") return base;
  const ms = anim === "fade" ? 180 : 220;
  const hidden =
    anim === "slide"
      ? "translateX(-24px)"
      : anim === "zoom"
        ? "scale(0.97)"
        : undefined;
  return {
    ...base,
    opacity: shown ? 1 : 0,
    transform: shown ? (anim === "fade" ? undefined : "none") : hidden,
    // 露出来那一侧立刻可见;隐藏那一侧等动画走完再真的隐藏
    transition: `opacity ${ms}ms ease-out, transform ${ms}ms ease-out, visibility 0s linear ${shown ? 0 : ms}ms`,
  };
}
