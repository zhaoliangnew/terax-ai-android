import { describe, expect, it } from "vitest";
import {
  parseWorkflowJournal,
  parseWorkflowMeta,
  settleJournal,
  workflowPhases,
  workflowRunDir,
  workflowScriptFile,
} from "./workflowProgress";

const SCRIPT = `export const meta = {
  name: 'task-to-agent-design',
  description: 'Map existing "plumbing", then design',
  phases: [
    { title: 'Understand', detail: 'parallel readers' },
    { title: 'Design', detail: 'independent designs' },
    { title: 'Synthesize', detail: 'judge' },
  ],
}

const X = { name: 'not-this' }
phase('Understand')
`;

const JOURNAL = [
  '{"type":"launched"}',
  '{"type":"started","key":"k1","agentId":"a1","label":"read:api","phase":"Understand"}',
  '{"type":"started","key":"k2","agentId":"a2","label":"read:ui","phase":"Understand"}',
  '{"type":"result","key":"k1","agentId":"a1","result":{"summary":"x"}}',
  '{"type":"failed","key":"k2","agentId":"a2"}',
  '{"type":"started","key":"k3","agentId":"a3","label":"design:mvp","phase":"Design"}',
  '{"type":"started","key":"k4","agentId":"a4","label":"extra","phase":"Bonus"}',
  '{"type":"started","key":"k5","agentId":"a5","lab', // 写到一半的行
].join("\n");

describe("workflowProgress", () => {
  it("reads meta name/description/phases, ignoring later objects", () => {
    expect(parseWorkflowMeta(SCRIPT)).toEqual({
      name: "task-to-agent-design",
      description: 'Map existing "plumbing", then design',
      phases: ["Understand", "Design", "Synthesize"],
    });
  });

  it("finds the run dir in the tool result", () => {
    expect(
      workflowRunDir(
        "Workflow launched in background. Task ID: x\nTranscript dir: /tmp/wf_1\nScript file: /tmp/s.js",
      ),
    ).toBe("/tmp/wf_1");
    expect(workflowRunDir("nothing here")).toBeNull();
  });

  it("tracks agent status from the journal and tolerates a partial last line", () => {
    const j = parseWorkflowJournal(JOURNAL);
    expect(j.agents.map((a) => [a.label, a.status])).toEqual([
      ["read:api", "done"],
      ["read:ui", "failed"],
      ["design:mvp", "running"],
      ["extra", "running"],
    ]);
    expect(j.phasesSeen).toEqual(["Understand", "Design", "Bonus"]);
  });

  it("lists declared phases first, pending ones included, extras after", () => {
    const phases = workflowPhases(
      parseWorkflowMeta(SCRIPT),
      parseWorkflowJournal(JOURNAL),
    );
    expect(
      phases.map((p) => [p.title, p.state, p.done, p.failed, p.total]),
    ).toEqual([
      ["Understand", "done", 1, 1, 2],
      ["Design", "running", 0, 0, 1],
      ["Synthesize", "pending", 0, 0, 0],
      ["Bonus", "running", 0, 0, 1],
    ]);
  });

  it("merges a resumed agent (same key, new agentId) and reads failed lines", () => {
    const j = parseWorkflowJournal(
      [
        '{"type":"started","key":"K","agentId":"old","label":"retry-me","phase":"P"}',
        '{"type":"started","key":"K","agentId":"new","label":"retry-me","phase":"P"}',
        '{"type":"result","key":"K","agentId":"new","result":{"ok":1}}',
        '{"type":"started","key":"F","agentId":"f1","label":"boom","phase":"P"}',
        '{"type":"failed","key":"F","agentId":"f1"}',
        '{"type":"result","key":"N","agentId":"n1","result":null}',
      ].join("\n"),
    );
    expect(j.agents.map((a) => [a.label, a.status])).toEqual([
      ["retry-me", "done"],
      ["boom", "failed"],
    ]);
  });

  it("marks agents still running as stopped once the workflow has ended", () => {
    const j = parseWorkflowJournal(JOURNAL);
    expect(settleJournal(j, false)).toBe(j);
    const settled = settleJournal(j, true);
    expect(settled.agents.filter((a) => a.status === "running")).toHaveLength(
      0,
    );
    expect(settled.agents.filter((a) => a.status === "stopped")).toHaveLength(
      2,
    );
    const phases = workflowPhases(parseWorkflowMeta(SCRIPT), settled);
    expect(phases.find((p) => p.title === "Design")).toMatchObject({
      state: "done",
      failed: 1,
    });
  });

  it("keeps phases whose detail contains ']' and unescapes quotes", () => {
    const meta = parseWorkflowMeta(`export const meta = {
  name: 'it\\'s',
  description: "say \\"hi\\"",
  phases: [
    { title: 'Scan', detail: 'list [a] and [b]' },
    { title: 'Fix', detail: 'x' },
  ],
}
`);
    expect(meta).toEqual({
      name: "it's",
      description: 'say "hi"',
      phases: ["Scan", "Fix"],
    });
  });

  it("finds the script file for named workflows", () => {
    expect(
      workflowScriptFile(
        "Transcript dir: /a\nScript file: /s/x.js\nRun ID: wf_1",
      ),
    ).toBe("/s/x.js");
  });
});
