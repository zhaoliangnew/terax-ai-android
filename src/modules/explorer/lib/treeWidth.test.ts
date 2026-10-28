import { describe, expect, it } from "vitest";
import { TREE_INDENT, treeContentWidth } from "./treeWidth";

const measure = (t: string) => t.length * 10;

describe("treeContentWidth", () => {
  it("is wide enough for the deepest, longest name", () => {
    const w = treeContentWidth(
      [
        { depth: 0, name: "app" },
        { depth: 12, name: "ServerTimeFrontV1.kt" },
      ],
      measure,
    );
    expect(w).toBeGreaterThanOrEqual(12 * TREE_INDENT + 200);
  });

  it("ignores rows without a name", () => {
    expect(treeContentWidth([{ depth: 30 }], measure)).toBe(0);
  });
});
