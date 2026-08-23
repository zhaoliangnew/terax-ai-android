import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addEntry,
  dayKeyOf,
  loadDay,
  monthDayKeys,
  monthEntries,
  monthKeyOf,
  removeEntry,
  weekDayKeys,
  weekEntries,
  weekKeyOf,
} from "./journal";

/** 2026-08-24 是周一。挑一个跨月的周(08-31 ~ 09-06)另测一次边界。 */
const MON = new Date(2026, 7, 24);
const TUE = new Date(2026, 7, 25);

// 测试跑在 node 里,没有真的 localStorage —— 塞一个内存版进去。
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

beforeEach(() => {
  store.clear();
});

describe("增删", () => {
  it("删掉的条目不再出现在按周/按月里", () => {
    const day = dayKeyOf(MON);
    addEntry(day, "甲", MON, "开发任务");
    addEntry(day, "乙", MON, "售后");
    expect(loadDay(day).entries).toHaveLength(2);

    const id = loadDay(day).entries[0].id;
    removeEntry(day, id);

    // 三个视图读的是同一份数据,删完必须一起干净
    expect(loadDay(day).entries.map((e) => e.text)).toEqual(["乙"]);
    expect(weekEntries(weekKeyOf(MON)).map((e) => e.text)).toEqual(["乙"]);
    expect(monthEntries(monthKeyOf(MON)).map((e) => e.text)).toEqual(["乙"]);
  });

  it("删光之后这一天从存储里消失,不留空壳", () => {
    const day = dayKeyOf(MON);
    addEntry(day, "甲", MON, "开发任务");
    removeEntry(day, loadDay(day).entries[0].id);
    expect(loadDay(day).entries).toHaveLength(0);
    expect(localStorage.getItem("terax.journal.days")).toBe("{}");
  });

  it("按周汇总跨天,顺序按日期", () => {
    addEntry(dayKeyOf(TUE), "周二的", TUE, "会议");
    addEntry(dayKeyOf(MON), "周一的", MON, "开发任务");
    expect(weekEntries(weekKeyOf(MON)).map((e) => e.text)).toEqual([
      "周一的",
      "周二的",
    ]);
  });
});

describe("周和月的边界", () => {
  it("一周七天,周一起头", () => {
    const days = weekDayKeys(weekKeyOf(MON));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-24");
    expect(days[6]).toBe("2026-08-30");
  });

  it("跨月的那一周照样是连续七天", () => {
    const days = weekDayKeys(weekKeyOf(new Date(2026, 7, 31)));
    expect(days[0]).toBe("2026-08-31");
    expect(days[6]).toBe("2026-09-06");
  });

  it("月份天数交给 Date 算,二月和闰年都不用自己数", () => {
    expect(monthDayKeys("2026-02")).toHaveLength(28);
    expect(monthDayKeys("2024-02")).toHaveLength(29);
    expect(monthDayKeys("2026-08")).toHaveLength(31);
  });

  it("跨年那几天按 ISO 周算,不会串到自然年", () => {
    // 2026-12-31 是周四,属于 2026 年第 53 周
    expect(weekKeyOf(new Date(2026, 11, 31))).toBe("2026-W53");
    // 2027-01-01 是周五,还在同一周里
    expect(weekKeyOf(new Date(2027, 0, 1))).toBe("2026-W53");
  });
});
