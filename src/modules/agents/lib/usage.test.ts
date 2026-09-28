import { describe, expect, it } from "vitest";
import { claudeUsage, codexUsage, resetLabel } from "./usage";

describe("claudeUsage", () => {
  it("reads the server's limits list", () => {
    const u = claudeUsage({
      subscriptionType: "max",
      available: true,
      rateLimits: {
        limits: [
          { kind: "session", percent: 29, resets_at: "2026-09-28T11:59:59Z" },
          { kind: "weekly_all", percent: 6, resets_at: null },
          {
            kind: "weekly_scoped",
            percent: 0,
            scope: { model: { display_name: "Fable" } },
          },
        ],
      },
    });
    expect(u.plan).toBe("max");
    expect(u.windows.map((w) => [w.label, w.percent])).toEqual([
      ["5 小时", 29],
      ["每周(所有模型)", 6],
      ["每周 Fable", 0],
    ]);
    expect(u.windows[0].resetsAt).toBe(Date.parse("2026-09-28T11:59:59Z"));
  });

  it("falls back to the fixed windows, and is empty without a plan", () => {
    expect(
      claudeUsage({
        available: true,
        rateLimits: { five_hour: { utilization: 10, resets_at: null } },
      }).windows,
    ).toEqual([{ label: "5 小时", percent: 10, resetsAt: null }]);
    expect(claudeUsage({ available: false }).windows).toEqual([]);
    expect(claudeUsage(null).windows).toEqual([]);
  });
});

describe("codexUsage", () => {
  it("labels windows by their length", () => {
    const u = codexUsage([
      {
        planType: "pro",
        primary: { usedPercent: 15, windowDurationMins: 10080, resetsAt: 100 },
        secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: null },
      },
    ]);
    expect(u.plan).toBe("pro");
    expect(u.windows).toEqual([
      { label: "每周", percent: 15, resetsAt: 100_000 },
      { label: "5 小时", percent: 40, resetsAt: null },
    ]);
  });
});

describe("resetLabel", () => {
  it("says today / tomorrow / date", () => {
    const now = new Date(2026, 8, 28, 10, 0).getTime();
    expect(resetLabel(new Date(2026, 8, 28, 18, 5).getTime(), now)).toBe(
      "今天 18:05",
    );
    expect(resetLabel(new Date(2026, 8, 29, 9, 0).getTime(), now)).toBe(
      "明天 09:00",
    );
    expect(resetLabel(new Date(2026, 9, 5, 10, 59).getTime(), now)).toBe(
      "10月5日 10:59",
    );
  });
});
