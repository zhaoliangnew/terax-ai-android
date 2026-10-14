import { describe, expect, it } from "vitest";
import {
  coerceVisibleChatAgents,
  firstVisibleChatAgent,
  firstVisiblePaneAgent,
} from "./store";

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
    const all = ["claude", "codex", "antigravity", "qoder"];
    expect(coerceVisibleChatAgents(undefined)).toEqual(all);
    expect(coerceVisibleChatAgents("claude")).toEqual(all);
    expect(coerceVisibleChatAgents([])).toEqual(all);
    expect(coerceVisibleChatAgents(["gemini"])).toEqual(all);
  });

  it("puts Antigravity before Qoder", () => {
    expect(coerceVisibleChatAgents(["qoder", "antigravity", "codex"])).toEqual([
      "codex",
      "antigravity",
      "qoder",
    ]);
  });

  it("needs at least one agent that can chat", () => {
    expect(coerceVisibleChatAgents(["antigravity"])).toEqual([
      "claude",
      "codex",
      "antigravity",
      "qoder",
    ]);
  });
});

describe("firstVisiblePaneAgent", () => {
  it("can pick a CLI-only agent", () => {
    expect(
      firstVisiblePaneAgent(
        ["antigravity", "claude"],
        ["claude", "antigravity"],
      ),
    ).toBe("antigravity");
  });

  it("skips hidden ones", () => {
    expect(firstVisiblePaneAgent(["antigravity", "codex"], ["codex"])).toBe(
      "codex",
    );
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

  it("skips agents that have no chat", () => {
    expect(
      firstVisibleChatAgent(["antigravity", "qoder"], ["antigravity", "qoder"]),
    ).toBe("qoder");
    expect(
      firstVisibleChatAgent(["antigravity"], ["codex", "antigravity"]),
    ).toBe("codex");
  });

  it("treats an empty visible list as all agents", () => {
    expect(firstVisibleChatAgent(["qoder"], [])).toBe("qoder");
    expect(firstVisibleChatAgent([null], [])).toBe("claude");
  });
});
