import { describe, expect, it } from "vitest";
import { coerceVisibleChatAgents, firstVisibleChatAgent } from "./store";

describe("coerceVisibleChatAgents", () => {
  it("keeps known agents in canonical order without duplicates", () => {
    expect(coerceVisibleChatAgents(["qoder", "claude", "qoder"])).toEqual([
      "claude",
      "qoder",
    ]);
  });

  it("drops unknown entries", () => {
    expect(coerceVisibleChatAgents(["codex", "gemini", 1, null])).toEqual([
      "codex",
    ]);
  });

  it("shows every agent when nothing usable is stored", () => {
    const all = ["claude", "codex", "qoder"];
    expect(coerceVisibleChatAgents(undefined)).toEqual(all);
    expect(coerceVisibleChatAgents("claude")).toEqual(all);
    expect(coerceVisibleChatAgents([])).toEqual(all);
    expect(coerceVisibleChatAgents(["gemini"])).toEqual(all);
  });
});

describe("firstVisibleChatAgent", () => {
  it("takes the first candidate that is visible", () => {
    expect(firstVisibleChatAgent(["qoder", "codex"], ["claude", "codex"])).toBe(
      "codex",
    );
  });

  it("skips empty candidates", () => {
    expect(firstVisibleChatAgent([null, undefined, "qoder"], ["qoder"])).toBe(
      "qoder",
    );
  });

  it("falls back to the first visible agent", () => {
    expect(firstVisibleChatAgent(["claude"], ["codex", "qoder"])).toBe("codex");
    expect(firstVisibleChatAgent([], ["qoder"])).toBe("qoder");
  });

  it("treats an empty visible list as all agents", () => {
    expect(firstVisibleChatAgent(["qoder"], [])).toBe("qoder");
    expect(firstVisibleChatAgent([null], [])).toBe("claude");
  });
});
