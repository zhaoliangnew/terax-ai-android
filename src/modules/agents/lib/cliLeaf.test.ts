import { describe, expect, it } from "vitest";
import {
  cliLeafId,
  cliLeafIds,
  isSafeSessionId,
  resumeInCliInput,
  resumeLaunchCommand,
} from "./cliLeaf";

describe("session handoff to the command line", () => {
  const id = "270f003d-17c1-426b-9b03-cdaef7af3007";

  it("only accepts ids that are safe to type into a shell", () => {
    expect(isSafeSessionId(id)).toBe(true);
    expect(isSafeSessionId("a; rm -rf ~")).toBe(false);
    expect(isSafeSessionId("$(x)")).toBe(false);
    expect(isSafeSessionId("")).toBe(false);
  });

  it("builds each agent's resume launch", () => {
    expect(resumeLaunchCommand("claude", "claude -x", id)).toBe(
      `claude -x --resume ${id}`,
    );
    expect(resumeLaunchCommand("qoder", "qodercn -x", id)).toBe(
      `qodercn -x --resume ${id}`,
    );
    expect(resumeLaunchCommand("codex", "codex -x", id)).toBe(
      `codex -x resume ${id}`,
    );
    expect(resumeLaunchCommand("antigravity", "agy -x", id)).toBe(
      `agy -x --conversation ${id}`,
    );
  });

  it("switches a running Claude or Qoder in place, not Codex", () => {
    expect(resumeInCliInput("claude", id)).toBe(`/resume ${id}\r`);
    expect(resumeInCliInput("qoder", id)).toBe(`/resume ${id}\r`);
    expect(resumeInCliInput("codex", id)).toBeNull();
    expect(resumeInCliInput("antigravity", id)).toBeNull();
  });
});

describe("command-line terminal ids", () => {
  it("never collide across panes and agents", () => {
    const ids = [1, 2, 3].flatMap(cliLeafIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cliLeafIds(2)).toContain(cliLeafId(2, "antigravity"));
  });
});
