import type { GroupImperativeHandle } from "react-resizable-panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    }
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
  useEffect: (effect: () => unknown) => {
    const cleanup = effect();
    if (typeof cleanup === "function")
      hooks.cleanups.push(cleanup as () => void);
  },
  useLayoutEffect: (effect: () => void) => effect(),
  useCallback: (callback: unknown) => callback,
}));

import { useRightFlyout } from "@/app/useRightFlyout";

let width: number;
let mediaChange: (() => void) | undefined;
let layout: Record<string, number>;
let setLayout: ReturnType<typeof vi.fn>;
let groupRef: { current: GroupImperativeHandle | null };

function FlyoutHarness() {
  hooks.cursor = 0;
  return useRightFlyout(groupRef);
}
function resize(next: number) {
  width = next;
  mediaChange?.();
  return FlyoutHarness();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  mediaChange = undefined;
  width = 1440;
  layout = { sidebar: 20, workspace: 50, device: 30 };
  setLayout = vi.fn((next) => {
    layout = next;
  });
  groupRef = {
    current: {
      getLayout: () => layout,
      setLayout,
    } as unknown as GroupImperativeHandle,
  };
  vi.stubGlobal("window", {
    matchMedia: (query: string) => {
      const maximum = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
      return {
        get matches() {
          return width <= maximum;
        },
        addEventListener: (_event: string, listener: () => void) => {
          mediaChange = listener;
        },
        removeEventListener: vi.fn(),
      };
    },
  });
});
afterEach(() => {
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

describe("小屏右栏自动收起", () => {
  it.each([1280, 1440, 1512, 1600])(
    "%i 宽窗口首次打开就隐藏右栏并归还聊天宽度",
    (initialWidth) => {
      width = initialWidth;
      const flyout = FlyoutHarness();
      expect(flyout.floating).toBe(true);
      expect(flyout.open).toBe(false);
      expect(layout).toEqual({ sidebar: 20, workspace: 80, device: 0 });
    },
  );

  it.each([1601, 1920, 2048, 2560, 3440])(
    "%i 宽窗口保留原来的三栏布局",
    (initialWidth) => {
      width = initialWidth;
      expect(FlyoutHarness().floating).toBe(false);
      expect(setLayout).not.toHaveBeenCalled();
    },
  );

  it("宽屏缩到截图大小时收起右栏,重新放大后恢复原布局", () => {
    width = 2560;
    FlyoutHarness();
    expect(resize(1440).floating).toBe(true);
    expect(layout).toEqual({ sidebar: 20, workspace: 80, device: 0 });
    expect(resize(2560).floating).toBe(false);
    expect(layout).toEqual({ sidebar: 20, workspace: 50, device: 30 });
  });

  it("右栏全屏时缩小窗口也能恢复聊天区域", () => {
    width = 2560;
    layout = { sidebar: 20, workspace: 0, device: 80 };
    FlyoutHarness();
    resize(1440);
    expect(layout).toEqual({ sidebar: 20, workspace: 80, device: 0 });
    resize(2560);
    expect(layout).toEqual({ sidebar: 20, workspace: 0, device: 80 });
  });
});
