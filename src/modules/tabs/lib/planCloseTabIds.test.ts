import { describe, expect, it } from "vitest";
import { planCloseTabIds, type Tab } from "./useTabs";

function tab(id: number, spaceId: string): Tab {
  return {
    id,
    kind: "editor",
    spaceId,
    title: `tab-${id}`,
    path: `/file-${id}`,
    dirty: false,
    preview: false,
  } as Tab;
}

describe("planCloseTabIds", () => {
  it("keeps the active tab as anchor when it is not being closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseTabIds(tabs, [1, 3], 2)).toEqual({
      anchorId: 2,
      plan: { closeIds: [1, 3], nextActiveId: 2 },
    });
  });

  it("moves to the first remaining tab when the active tab is closed", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "a")];
    expect(planCloseTabIds(tabs, [2, 3], 2)).toEqual({
      anchorId: 1,
      plan: { closeIds: [2, 3], nextActiveId: 1 },
    });
  });

  it("ignores tabs in other spaces", () => {
    const tabs = [tab(1, "a"), tab(2, "b"), tab(3, "a")];
    expect(planCloseTabIds(tabs, [1, 2], 3)).toEqual({
      anchorId: 3,
      plan: { closeIds: [1], nextActiveId: 3 },
    });
  });

  it("refuses to close every tab in the space", () => {
    const tabs = [tab(1, "a"), tab(2, "a"), tab(3, "b")];
    expect(planCloseTabIds(tabs, [1, 2], 1).anchorId).toBeNull();
  });

  it("does nothing when no requested tab exists", () => {
    const tabs = [tab(1, "a")];
    expect(planCloseTabIds(tabs, [9], 1)).toEqual({
      anchorId: null,
      plan: { closeIds: [], nextActiveId: 1 },
    });
  });
});
