/**
 * 工作日志:随手记一条,到点了拼成日报/周报。
 *
 * 两个维度各存一份,互不覆盖:
 *  - 按日:计划 + 随手记的条目 + 总结
 *  - 按周:计划 + 总结(条目不单独存,周视图直接汇总那一周的日条目)
 *
 * 时间一律用**本地日**切分,不用 UTC —— 晚上十一点记的东西必须落在今天。
 */

/** 记一条时选的类型。顺序就是界面上的顺序,常用的在前。 */
export const ENTRY_KINDS = [
  "开发任务",
  "售后",
  "技术支持",
  "会议",
  "咨询",
  "其他",
] as const;

export type EntryKind = (typeof ENTRY_KINDS)[number];

export type JournalEntry = {
  id: string;
  /** ISO 时间戳,显示只用到时:分。 */
  at: string;
  text: string;
  /** 老数据没有这个字段,渲染时就不显示标签 —— 不给它硬塞一个"其他"。 */
  kind?: EntryKind;
};

const LAST_KIND_KEY = "terax.journal.lastKind";

/** 上次选的类型。一天里多半连着记同一类,省得每条都重选。 */
export function lastKind(): EntryKind {
  if (typeof localStorage === "undefined") return ENTRY_KINDS[0];
  const v = localStorage.getItem(LAST_KIND_KEY);
  return (ENTRY_KINDS as readonly string[]).includes(v ?? "")
    ? (v as EntryKind)
    : ENTRY_KINDS[0];
}

export function rememberKind(kind: EntryKind): void {
  localStorage.setItem(LAST_KIND_KEY, kind);
}

export type DayLog = {
  plan: string;
  summary: string;
  entries: JournalEntry[];
};

export type WeekLog = {
  plan: string;
  summary: string;
};

const DAYS_KEY = "terax.journal.days";
const WEEKS_KEY = "terax.journal.weeks";

const EMPTY_DAY: DayLog = { plan: "", summary: "", entries: [] };
const EMPTY_WEEK: WeekLog = { plan: "", summary: "" };

function read<T>(key: string): Record<string, T> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function write<T>(key: string, value: Record<string, T>): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadDay(day: string): DayLog {
  const all = read<DayLog>(DAYS_KEY);
  const d = all[day];
  if (!d) return { ...EMPTY_DAY, entries: [] };
  return {
    plan: d.plan ?? "",
    summary: d.summary ?? "",
    entries: Array.isArray(d.entries) ? d.entries : [],
  };
}

function saveDay(day: string, log: DayLog): DayLog {
  const all = read<DayLog>(DAYS_KEY);
  // 三样都空就把这天删掉,免得历史里堆一串空壳。
  if (!log.plan && !log.summary && log.entries.length === 0) delete all[day];
  else all[day] = log;
  write(DAYS_KEY, all);
  return loadDay(day);
}

export function loadWeek(week: string): WeekLog {
  const all = read<WeekLog>(WEEKS_KEY);
  const w = all[week];
  return w
    ? { plan: w.plan ?? "", summary: w.summary ?? "" }
    : { ...EMPTY_WEEK };
}

export function saveWeek(week: string, log: WeekLog): WeekLog {
  const all = read<WeekLog>(WEEKS_KEY);
  if (!log.plan && !log.summary) delete all[week];
  else all[week] = log;
  write(WEEKS_KEY, all);
  return loadWeek(week);
}

export function setDayField(
  day: string,
  field: "plan" | "summary",
  value: string,
): DayLog {
  const log = loadDay(day);
  return saveDay(day, { ...log, [field]: value });
}

export function addEntry(
  day: string,
  text: string,
  at: Date,
  kind: EntryKind,
): DayLog {
  const trimmed = text.trim();
  if (!trimmed) return loadDay(day);
  rememberKind(kind);
  const log = loadDay(day);
  const entry: JournalEntry = {
    id: `${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: at.toISOString(),
    text: trimmed,
    kind,
  };
  return saveDay(day, { ...log, entries: [...log.entries, entry] });
}

export function editEntry(day: string, id: string, text: string): DayLog {
  const log = loadDay(day);
  const trimmed = text.trim();
  if (!trimmed) return removeEntry(day, id);
  return saveDay(day, {
    ...log,
    entries: log.entries.map((e) =>
      e.id === id ? { ...e, text: trimmed } : e,
    ),
  });
}

export function removeEntry(day: string, id: string): DayLog {
  const log = loadDay(day);
  return saveDay(day, {
    ...log,
    entries: log.entries.filter((e) => e.id !== id),
  });
}

// ---- 日期 ----------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function shiftDay(key: string, delta: number): string {
  const d = parseDayKey(key);
  d.setDate(d.getDate() + delta);
  return dayKeyOf(d);
}

/** 周一 = 0。 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * ISO 周:周四落在哪年就算哪年的周,1 月 4 日一定在第 1 周。
 * 跨年那几天用自然年会算错(比如 12-31 可能属于下一年的第 1 周)。
 */
export function weekKeyOf(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - mondayIndex(t) + 3); // 挪到本周四
  const jan4 = new Date(t.getFullYear(), 0, 4);
  const firstThursday = new Date(jan4);
  firstThursday.setDate(jan4.getDate() - mondayIndex(jan4) + 3);
  const week =
    1 +
    Math.round(
      (t.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${t.getFullYear()}-W${pad(week)}`;
}

export function mondayOfWeek(key: string): Date {
  const [ys, ws] = key.split("-W");
  const year = Number(ys);
  const week = Number(ws);
  const jan4 = new Date(year, 0, 4);
  const monday1 = new Date(year, 0, 4 - mondayIndex(jan4));
  return new Date(
    monday1.getFullYear(),
    monday1.getMonth(),
    monday1.getDate() + (week - 1) * 7,
  );
}

/** 某一天属于哪一周。按日视图上面那排星期要知道自己该画哪七天。 */
export function weekOfDay(key: string): string {
  return weekKeyOf(parseDayKey(key));
}

export function shiftWeek(key: string, delta: number): string {
  const m = mondayOfWeek(key);
  m.setDate(m.getDate() + delta * 7);
  return weekKeyOf(m);
}

export function weekDayKeys(key: string): string[] {
  const m = mondayOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(m.getFullYear(), m.getMonth(), m.getDate() + i);
    return dayKeyOf(d);
  });
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function dayLabel(key: string): string {
  const d = parseDayKey(key);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[mondayIndex(d)]}`;
}

/** 只要"周三"。周视图的列头用。 */
export function weekdayName(key: string): string {
  return WEEKDAYS[mondayIndex(parseDayKey(key))];
}

/** 只要"08-23"。 */
export function monthDay(key: string): string {
  const d = parseDayKey(key);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekLabel(key: string): string {
  const m = mondayOfWeek(key);
  const sun = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6);
  const span = `${pad(m.getMonth() + 1)}-${pad(m.getDate())} ~ ${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}`;
  return `${key.replace("-W", " 第 ")} 周 · ${span}`;
}

export function entryTime(at: string): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- 导出 ----------------------------------------------------------------

function section(title: string, body: string): string {
  return body.trim() ? `### ${title}\n${body.trim()}\n` : "";
}

export function dayMarkdown(day: string): string {
  const log = loadDay(day);
  const entries = log.entries
    .map((e) => `- ${entryTime(e.at)}${e.kind ? ` [${e.kind}]` : ""} ${e.text}`)
    .join("\n");
  const parts = [
    `## ${day}(${dayLabel(day).split(" ")[1]})`,
    section("计划", log.plan),
    section("做了什么", entries),
    section("总结", log.summary),
  ];
  return parts.filter(Boolean).join("\n").trimEnd();
}

export function weekMarkdown(week: string): string {
  const log = loadWeek(week);
  const days = weekDayKeys(week)
    .map((d) => {
      const dayLog = loadDay(d);
      if (dayLog.entries.length === 0) return "";
      const lines = dayLog.entries
        .map((e) => `  - ${e.kind ? `[${e.kind}] ` : ""}${e.text}`)
        .join("\n");
      return `- ${dayLabel(d)}\n${lines}`;
    })
    .filter(Boolean)
    .join("\n");
  const parts = [
    `## ${weekLabel(week)}`,
    section("计划", log.plan),
    section("做了什么", days),
    section("总结", log.summary),
  ];
  return parts.filter(Boolean).join("\n").trimEnd();
}
