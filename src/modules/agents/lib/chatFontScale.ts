import { create } from "zustand";

/**
 * 聊天区对话内容的字号(按比例缩放,80%~150%,默认 100%)。顶部"聊天/命令行/
 * 终端"旁边 A−/A+ 调,只影响中间的对话,别处不变。记在本地。
 */
const KEY = "terax.chat.fontScale";
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.5;

function load(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n >= FONT_SCALE_MIN && n <= FONT_SCALE_MAX ? n : 1;
  } catch {
    return 1;
  }
}

export const useChatFontScale = create<{
  scale: number;
  set: (n: number) => void;
}>((set) => ({
  scale: load(),
  set: (n) => {
    const scale =
      Math.round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n)) * 10) /
      10;
    try {
      localStorage.setItem(KEY, String(scale));
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ scale });
  },
}));

/**
 * 输入框打字效果:关 / 打字机(新字亮一下蓝色再变回来)/ 淡入。记在本地。
 * 打字机不换字体、字不移位:以前换等宽字体、一个个落下,打快了会跳、和光标错开。
 */
export type TypingEffect =
  | "off"
  | "typewriter"
  | "fade"
  | "blur"
  | "neon"
  | "rainbow";

export const TYPING_EFFECTS: { value: TypingEffect; label: string }[] = [
  { value: "off", label: "无效果" },
  { value: "typewriter", label: "打字机" },
  { value: "fade", label: "淡入" },
  { value: "blur", label: "模糊" },
  { value: "neon", label: "霓虹" },
  { value: "rainbow", label: "彩虹" },
];
const EFFECT_KEY = "terax.chat.typingEffect";

function loadEffect(): TypingEffect {
  try {
    const v = localStorage.getItem(EFFECT_KEY);
    return TYPING_EFFECTS.some((e) => e.value === v)
      ? (v as TypingEffect)
      : "off";
  } catch {
    return "off";
  }
}

const SOUND_KEY = "terax.chat.typingSound";

export const useTypingEffect = create<{
  effect: TypingEffect;
  /** 每打一个字响一下"咔哒"(和哪种效果都能搭)。 */
  sound: boolean;
  set: (e: TypingEffect) => void;
  setSound: (on: boolean) => void;
}>((set) => ({
  effect: loadEffect(),
  sound: (() => {
    try {
      return localStorage.getItem(SOUND_KEY) === "1";
    } catch {
      return false;
    }
  })(),
  set: (effect) => {
    try {
      localStorage.setItem(EFFECT_KEY, effect);
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ effect });
  },
  setSound: (on) => {
    try {
      localStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ sound: on });
  },
}));
