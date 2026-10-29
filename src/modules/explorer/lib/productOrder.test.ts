import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });

const { moveGroup, moveToGroup, resolveLayout } = await import(
  "./productOrder"
);

describe("resolveLayout", () => {
  it("uses the auto columns when nothing is saved", () => {
    expect(
      resolveLayout(["a", "b", "c"], undefined, [["a", "b"], ["c"]]),
    ).toEqual([
      { title: "", names: ["a", "b"] },
      { title: "", names: ["c"] },
    ]);
  });

  it("keeps saved groups, drops gone products, appends new ones to the last group", () => {
    const saved = [
      { title: "秤", names: ["c", "x"] },
      { title: "网关", names: ["a"] },
    ];
    expect(resolveLayout(["a", "b", "c"], saved, [])).toEqual([
      { title: "秤", names: ["c"] },
      { title: "网关", names: ["a", "b"] },
    ]);
  });
});

describe("moveToGroup", () => {
  const groups = [
    { title: "A", names: ["a", "b"] },
    { title: "B", names: ["c", "d"] },
  ];

  it("inserts before or after a target in another group", () => {
    expect(moveToGroup(groups, "a", 1, "d", false)).toEqual([
      { title: "A", names: ["b"] },
      { title: "B", names: ["c", "a", "d"] },
    ]);
    expect(moveToGroup(groups, "a", 1, "c", true)).toEqual([
      { title: "A", names: ["b"] },
      { title: "B", names: ["c", "a", "d"] },
    ]);
  });

  it("reorders within the same group", () => {
    expect(moveToGroup(groups, "a", 0, "b", true)).toEqual([
      { title: "A", names: ["b", "a"] },
      { title: "B", names: ["c", "d"] },
    ]);
  });

  it("appends to the end when dropped on the group itself", () => {
    expect(moveToGroup(groups, "b", 1, null, false)).toEqual([
      { title: "A", names: ["a"] },
      { title: "B", names: ["c", "d", "b"] },
    ]);
  });

  it("does not mutate the input", () => {
    moveToGroup(groups, "a", 1, null, false);
    expect(groups[0].names).toEqual(["a", "b"]);
  });
});

describe("moveGroup", () => {
  const g = ["A", "B", "C"].map((title) => ({ title, names: [] }));
  const titles = (x: { title: string }[]) => x.map((t) => t.title);

  it("moves a group after a later one", () => {
    expect(titles(moveGroup(g, 0, 2, true))).toEqual(["B", "C", "A"]);
  });

  it("moves a group before an earlier one", () => {
    expect(titles(moveGroup(g, 2, 0, false))).toEqual(["C", "A", "B"]);
  });

  it("ignores dropping on itself", () => {
    expect(titles(moveGroup(g, 1, 1, true))).toEqual(["A", "B", "C"]);
  });
});
