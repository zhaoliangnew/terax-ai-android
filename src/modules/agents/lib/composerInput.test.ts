import { describe, expect, it } from "vitest";
import {
  arrowAtInputBoundary,
  cleanComposerInput,
} from "@/modules/agents/lib/composerInput";

describe("composer input", () => {
  it("removes macOS arrow control characters and preserves the cursor", () => {
    expect(cleanComposerInput("\uF700\uF700还有很多配置项", 2)).toEqual({
      text: "还有很多配置项",
      start: 0,
      end: 0,
    });
    expect(cleanComposerInput("文字\uF703\uF703", 4)).toEqual({
      text: "文字",
      start: 2,
      end: 2,
    });
    expect(cleanComposerInput("a\uF700b\uF703c", 2, 4)).toEqual({
      text: "abc",
      start: 1,
      end: 2,
    });
  });
  it("preserves ordinary text, newlines, arrow symbols and other private-use characters", () => {
    const text = "中文拼音\n← → ↑ ↓\n\uE000\uF704";
    expect(cleanComposerInput(text, 2, text.length)).toEqual({
      text,
      start: 2,
      end: text.length,
    });
  });
  it("only blocks arrow movement at the boundary with no active selection", () => {
    expect(arrowAtInputBoundary("ArrowUp", 4, 0, 0)).toBe(true);
    expect(arrowAtInputBoundary("ArrowLeft", 4, 0, 0)).toBe(true);
    expect(arrowAtInputBoundary("ArrowRight", 4, 4, 4)).toBe(true);
    expect(arrowAtInputBoundary("ArrowDown", 4, 4, 4)).toBe(true);
    for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown"]) {
      expect(arrowAtInputBoundary(key, 4, 2, 2)).toBe(false);
      expect(arrowAtInputBoundary(key, 4, 0, 4)).toBe(false);
      expect(arrowAtInputBoundary(key, 0, 0, 0)).toBe(true);
    }
    expect(arrowAtInputBoundary("Escape", 0, 0, 0)).toBe(false);
  });
});
