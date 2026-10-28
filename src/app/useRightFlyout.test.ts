import { describe, expect, it } from "vitest";
import { withoutRightPanel } from "@/app/useRightFlyout";

describe("小屏右栏浮层的分栏占位", () => {
  it("将右栏宽度还给工作区,侧栏宽度保持不变", () => {
    const desktop = { sidebar: 20, workspace: 50, device: 30 };
    expect(withoutRightPanel(desktop)).toEqual({
      sidebar: 20,
      workspace: 80,
      device: 0,
    });
    expect(desktop).toEqual({ sidebar: 20, workspace: 50, device: 30 });
  });

  it("从右栏全屏切到小屏时恢复聊天区", () => {
    expect(
      withoutRightPanel({ sidebar: 20, workspace: 0, device: 80 }),
    ).toEqual({ sidebar: 20, workspace: 80, device: 0 });
  });

  it("已折叠右栏不会再次改变工作区尺寸", () => {
    const collapsed = { sidebar: 20, workspace: 80, device: 0 };
    expect(withoutRightPanel(withoutRightPanel(collapsed))).toEqual(collapsed);
  });
});
