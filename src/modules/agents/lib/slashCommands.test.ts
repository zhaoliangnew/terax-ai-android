import { describe, expect, it } from "vitest";
import {
  commandQuery,
  commandsFromCodexSkills,
  commandsFromInit,
  matchCommands,
  mentionedSkills,
  normalizeCommands,
} from "./slashCommands";

describe("normalizeCommands", () => {
  it("keeps the SDK fields and drops duplicates and junk", () => {
    const list = normalizeCommands([
      { name: "review", description: "Review code", argumentHint: "<pr>" },
      { name: "/compact", description: "", argumentHint: "", builtin: true },
      { name: "review", description: "dup" },
      { name: "" },
      null,
    ]);
    expect(list.map((c) => c.name)).toEqual(["review", "compact"]);
    expect(list[0]).toMatchObject({ argumentHint: "<pr>", builtin: false });
    expect(list[1].builtin).toBe(true);
  });

  it("returns an empty list for non-arrays", () => {
    expect(normalizeCommands(undefined)).toEqual([]);
  });
});

describe("commandsFromInit", () => {
  it("marks skills and hides terminal-only commands", () => {
    const list = commandsFromInit({
      slash_commands: ["compact", "statusline", "pdf"],
      skills: ["pdf", "docx"],
      terminal_slash_commands: ["statusline"],
    });
    expect(list.map((c) => [c.name, c.builtin])).toEqual([
      ["compact", true],
      ["pdf", false],
      ["docx", false],
    ]);
  });
});

describe("commandsFromCodexSkills", () => {
  it("flattens entries, skips disabled skills and prefers the short description", () => {
    const list = commandsFromCodexSkills({
      data: [
        {
          cwd: "/a",
          skills: [
            {
              name: "pdf",
              description: "long",
              interface: { shortDescription: "short" },
              path: "/s/pdf/SKILL.md",
              enabled: true,
            },
            { name: "off", description: "", path: "/s/off", enabled: false },
          ],
        },
        {
          cwd: "/b",
          skills: [
            { name: "pdf", description: "x", path: "/y", enabled: true },
          ],
        },
      ],
    });
    expect(list).toEqual([
      {
        name: "pdf",
        description: "short",
        argumentHint: "",
        builtin: false,
        path: "/s/pdf/SKILL.md",
      },
    ]);
  });
});

describe("commandQuery", () => {
  it("finds a leading slash token", () => {
    expect(commandQuery("/rev", ["/"], false)).toEqual({
      trigger: "/",
      query: "rev",
      start: 0,
    });
    expect(commandQuery("/", ["/"], false)?.query).toBe("");
  });

  it("ignores tokens after other text unless anywhere is allowed", () => {
    expect(commandQuery("hi /rev", ["/"], false)).toBeNull();
    expect(commandQuery("hi $pd", ["$"], true)).toEqual({
      trigger: "$",
      query: "pd",
      start: 3,
    });
  });

  it("closes once the token is finished or is a path", () => {
    expect(commandQuery("/review ", ["/"], false)).toBeNull();
    expect(commandQuery("a/b", ["/"], true)).toBeNull();
  });
});

describe("matchCommands", () => {
  const cmds = normalizeCommands([
    { name: "compact", description: "Compact context", builtin: true },
    { name: "code-review", description: "Review the diff" },
    { name: "pdf", description: "Work with PDF files" },
  ]);

  it("lists skills before built-ins when the query is empty", () => {
    expect(matchCommands(cmds, "").map((c) => c.name)).toEqual([
      "code-review",
      "pdf",
      "compact",
    ]);
  });

  it("ranks prefix, then substring, then description matches", () => {
    expect(matchCommands(cmds, "co").map((c) => c.name)).toEqual([
      "code-review",
      "compact",
    ]);
    expect(matchCommands(cmds, "review").map((c) => c.name)).toEqual([
      "code-review",
    ]);
    expect(matchCommands(cmds, "files").map((c) => c.name)).toEqual(["pdf"]);
    expect(matchCommands(cmds, "zzz")).toEqual([]);
  });
});

describe("mentionedSkills", () => {
  const skills = commandsFromCodexSkills({
    data: [
      {
        skills: [
          { name: "pdf", description: "", path: "/p", enabled: true },
          { name: "docx", description: "", path: "/d", enabled: true },
        ],
      },
    ],
  });

  it("picks $name tokens that are known skills, once each", () => {
    expect(
      mentionedSkills(
        "$pdf then $docx and $pdf, not a$docx or $nope",
        skills,
      ).map((s) => s.name),
    ).toEqual(["pdf", "docx"]);
  });
});
