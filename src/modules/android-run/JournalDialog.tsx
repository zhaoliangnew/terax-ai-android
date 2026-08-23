import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addEntry,
  closeAfterAdd,
  type DayLog,
  dayKeyOf,
  dayLabel,
  dayMarkdown,
  ENTRY_KINDS,
  type EntryKind,
  editEntry,
  entryTime,
  groupByKind,
  type JournalEntry,
  loadDay,
  loadMonth,
  loadWeek,
  type MonthLog,
  monthDay,
  monthDayKeys,
  monthEntries,
  monthKeyOf,
  monthLabel,
  monthMarkdown,
  removeEntry,
  saveMonth,
  saveWeek,
  setCloseAfterAdd,
  setDayField,
  shiftMonth,
  shiftWeek,
  type WeekLog,
  weekDayKeys,
  weekdayName,
  weekEntries,
  weekKeyOf,
  weekLabel,
  weekMarkdown,
  weekOfDay,
} from "./lib/journal";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Mode = "day" | "week" | "month";

const FIELD =
  "w-full flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-ring";
const LABEL = "text-[13px] font-semibold text-foreground/75";
const NAV =
  "flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** 选中态的配色。类型多了之后,颜色比读字快。 */
const KIND_TONE: Record<EntryKind, string> = {
  开发任务: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
  售后: "border-amber-500/40 bg-amber-500/15 text-amber-400",
  技术支持: "border-blue-500/40 bg-blue-500/15 text-blue-400",
  会议: "border-violet-500/40 bg-violet-500/15 text-violet-400",
  咨询: "border-cyan-500/40 bg-cyan-500/15 text-cyan-400",
  其他: "border-border bg-accent text-foreground",
};

function KindTag({ kind }: { kind?: EntryKind }) {
  if (!kind) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-px text-[11px] leading-tight",
        KIND_TONE[kind],
      )}
    >
      {kind}
    </span>
  );
}

/**
 * 日报/周报。
 *
 * 版面按"看什么/写什么/记什么"分三块,而不是一根竖条从上排到下:
 *  - 顶部一行选日/周和翻页,顺带把当前日期写在标题里,少一行说明文字;
 *  - 主体左右分栏:左边是攒下来的记录(会越来越长),右边是计划和总结
 *    (要动笔写,所以给它一个能读的行宽 —— 通栏的输入框一行字扫不过来);
 *  - 录入贴在左栏记录的下面 —— 它喂的就是那个列表,放一起手不用来回横穿。
 *
 * 日和周各存各的计划/总结;周的"做了什么"不单独记,直接汇总那一周每天的条目
 * —— 一件事只记一次,写周报时不用再抄一遍。
 */
export function JournalDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(() => dayKeyOf(new Date()));
  const [week, setWeek] = useState(() => weekKeyOf(new Date()));
  const [month, setMonth] = useState(() => monthKeyOf(new Date()));
  const [dayLog, setDayLog] = useState<DayLog>(() => loadDay(day));
  const [weekLog, setWeekLog] = useState<WeekLog>(() => loadWeek(week));
  const [monthLog, setMonthLog] = useState<MonthLog>(() => loadMonth(month));
  const [draft, setDraft] = useState("");
  // 默认永远是开发任务 —— 绝大多数记录都是它。这一次里改过就跟着你改的走,
  // 但下次打开重新回到开发任务,不去记上次选的那个。
  const [kind, setKind] = useState<EntryKind>(ENTRY_KINDS[0]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  const scrollListToBottom = useCallback(() => {
    // 连等两帧再滚:第一次打开时这个 div 是刚挂上的,弹窗还在放入场动画,
    // 当帧量到的 scrollHeight 还不是排版完的值,滚了也是白滚。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  // 用回调 ref 而不是只靠 effect:effect 跑的时候 ref 可能还没接上(内容随
  // 弹窗一起挂载),接上的那一刻自己滚一次最稳。
  const attachList = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      if (el) scrollListToBottom();
    },
    [scrollListToBottom],
  );
  // 记录怎么排:按时间是"发生顺序",按分类是"日报要交的样子"
  const [group, setGroup] = useState<"time" | "kind">("time");
  const [closeAfter, setCloseAfter] = useState(() => closeAfterAdd());

  // 每次打开都回到今天 —— 上次翻到哪天了不重要,要记的是现在这条。
  //
  // 三份 log 也要重读一遍:下面那几个 effect 只在日期变了才跑,而"记完就关"
  // 之后再打开,日期还是今天 —— 于是列表停在关窗前的样子,可星期格上的条数是
  // 现读 localStorage 的,两边就对不上了(格子写着 12 条,列表只有 9 条)。
  useEffect(() => {
    if (!open) return;
    const d = dayKeyOf(new Date());
    const w = weekKeyOf(new Date());
    const m = monthKeyOf(new Date());
    setDay(d);
    setWeek(w);
    setMonth(m);
    setDayLog(loadDay(d));
    setWeekLog(loadWeek(w));
    setMonthLog(loadMonth(m));
    setDraft("");
    setKind(ENTRY_KINDS[0]);
    setCloseAfter(closeAfterAdd());
    setEditing(null);
  }, [open]);

  useEffect(() => setDayLog(loadDay(day)), [day]);
  useEffect(() => setWeekLog(loadWeek(week)), [week]);
  useEffect(() => setMonthLog(loadMonth(month)), [month]);

  // 条目按时间正序排(读起来是"上午…下午…"),所以最新的在最底下 —— 打开、
  // 换天、刚记完,都把列表滚到底,不然新记的那条在屏幕外面。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 这几个都是"该重新滚一次"的信号
  useEffect(() => {
    scrollListToBottom();
  }, [open, day, mode, group, dayLog, scrollListToBottom]);

  const today = dayKeyOf(new Date());
  const thisWeek = weekKeyOf(new Date());
  const thisMonth = monthKeyOf(new Date());
  // 按日时上下翻的也是"周" —— 一排星期直接点哪天,箭头只管换周,一套控件说清楚
  const shownWeek = mode === "day" ? weekOfDay(day) : week;
  const atNow =
    mode === "day"
      ? day === today
      : mode === "week"
        ? week === thisWeek
        : month === thisMonth;

  // 翻页:按月翻月,其余翻周
  const go = (delta: number) => {
    if (mode === "month") {
      setMonth(shiftMonth(month, delta));
      return;
    }
    const next = shiftWeek(shownWeek, delta);
    if (mode === "week") {
      setWeek(next);
      return;
    }
    // 翻到别的周时落在同一个星期几,而不是每次都跳回周一
    const offset = weekDayKeys(shownWeek).indexOf(day);
    setDay(weekDayKeys(next)[offset < 0 ? 0 : offset]);
  };

  const submit = useCallback(() => {
    if (!draft.trim()) return;
    // 记到"现在"所在的那天,不是当前翻到的那天 —— 翻着历史顺手记一条,
    // 结果落到上周三去,那就麻烦了。
    const now = new Date();
    const key = dayKeyOf(now);
    addEntry(key, draft, now, kind);
    setDraft("");
    // 记完就关:多数时候打开它就是为了记这一条,记完还杵在那儿反而要多点一下
    if (closeAfter) {
      onClose();
      return;
    }
    if (key === day) setDayLog(loadDay(day));
    else {
      setMode("day");
      setDay(key);
      toast.success("已记到今天", { description: dayLabel(key) });
    }
  }, [draft, day, kind, closeAfter, onClose]);

  // 周/月共用一份数据:一行一天。周把七天都列出来(空的留个"—",一眼看出哪天
  // 漏了);月里空着的日子直接不显示 —— 三十行里二十行是"—"就没法看了。
  // biome-ignore lint/correctness/useExhaustiveDependencies: dayLog 是重算信号
  const dayRows = useMemo(() => {
    if (mode === "week") {
      return weekDayKeys(week).map((d) => ({
        day: d,
        entries: loadDay(d).entries,
      }));
    }
    if (mode === "month") {
      return monthDayKeys(month)
        .map((d) => ({ day: d, entries: loadDay(d).entries }))
        .filter((r) => r.entries.length > 0);
    }
    // dayLog 是重算信号:在日视图刚记完一条,切回来这里得是新的
    return [];
  }, [mode, week, month, dayLog]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dayLog 是重算信号
  const periodEntries = useMemo(() => {
    if (mode === "week") return weekEntries(week);
    if (mode === "month") return monthEntries(month);
    return [];
  }, [mode, week, month, dayLog]);

  const copy = () => {
    // 复制出来的跟眼前看到的一致 —— 按分类看的时候多半就是要照这个格式交
    const byKind = group === "kind";
    const text =
      mode === "day"
        ? dayMarkdown(day, byKind)
        : mode === "week"
          ? weekMarkdown(week, byKind)
          : monthMarkdown(month, byKind);
    if (!text.trim()) {
      toast.error(
        `这一${mode === "day" ? "天" : mode === "week" ? "周" : "个月"}还什么都没有`,
      );
      return;
    }
    void copyToClipboard(text);
    toast.success("已复制", { description: "粘到日报里就行" });
  };

  const periodLog =
    mode === "day" ? dayLog : mode === "week" ? weekLog : monthLog;
  const plan = periodLog.plan;
  const summary = periodLog.summary;
  const setPlan = (v: string) => {
    if (mode === "day") setDayLog(setDayField(day, "plan", v));
    else if (mode === "week")
      setWeekLog(saveWeek(week, { ...weekLog, plan: v }));
    else setMonthLog(saveMonth(month, { ...monthLog, plan: v }));
  };
  // 标题跟着周期走:一眼知道自己在写哪一档的计划,不用回头看顶上选的是什么
  const periodWord = mode === "day" ? "今日" : mode === "week" ? "周" : "月";
  const setSummary = (v: string) => {
    if (mode === "day") setDayLog(setDayField(day, "summary", v));
    else if (mode === "week")
      setWeekLog(saveWeek(week, { ...weekLog, summary: v }));
    else setMonthLog(saveMonth(month, { ...monthLog, summary: v }));
  };

  // 一条记录长什么样。按时间和按分类两种排法都用它,别写两遍。
  const entryRow = (e: JournalEntry) => (
    <div
      key={e.id}
      className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/40"
    >
      <span className="shrink-0 pt-0.5 font-mono text-[12px] text-muted-foreground/60 tabular-nums">
        {entryTime(e.at)}
      </span>
      <span className="shrink-0 pt-0.5">
        <KindTag kind={e.kind} />
      </span>
      {editing?.id === e.id ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: 点了才进编辑态
          autoFocus
          value={editing.text}
          onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
          onKeyDown={(ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") {
              setDayLog(editEntry(day, e.id, editing.text));
              setEditing(null);
            } else if (ev.key === "Escape") setEditing(null);
          }}
          onBlur={() => {
            setDayLog(editEntry(day, e.id, editing.text));
            setEditing(null);
          }}
          className="min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 py-0.5 text-[13.5px] outline-none focus:border-ring"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing({ id: e.id, text: e.text })}
          className="min-w-0 flex-1 text-left text-[13.5px] leading-relaxed"
        >
          {e.text}
        </button>
      )}
      <button
        type="button"
        title="删除"
        onClick={() => setDayLog(removeEntry(day, e.id))}
        className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
      >
        <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
      </button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[64vh] max-h-[680px] w-[84vw] max-w-none flex-col gap-0 p-0 sm:max-w-[920px]">
        {/* 顶栏:是日还是周、看的哪一天、怎么翻 —— 一行说完 */}
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-4 py-3">
          <div className="flex items-center gap-3 pr-8">
            {/* 跟右边那个开关叫一个名字。原来这里写"日报"、开关写"按日",
                同一件事两种叫法,读起来要在脑子里对一次。 */}
            <DialogTitle className="shrink-0 text-lg font-semibold">
              {mode === "day" ? "按日" : mode === "week" ? "按周" : "按月"}
            </DialogTitle>
            <span className="min-w-0 truncate text-[15px] text-muted-foreground">
              {mode === "day"
                ? `${day} ${weekdayName(day)}`
                : mode === "week"
                  ? weekLabel(week)
                  : monthLabel(month)}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
                {(["day", "week", "month"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded-md px-3 py-1 text-[13px] transition-colors",
                      mode === m
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "day" ? "按日" : m === "week" ? "按周" : "按月"}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={copy}
                title="复制成 Markdown,粘到日报里"
                className="h-9 text-[13px]"
              >
                <HugeiconsIcon icon={Copy01Icon} size={15} strokeWidth={1.75} />
                复制
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* 翻页 + 选星期:箭头一律按周翻,日/周两种模式一套操作 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
          <button
            type="button"
            className={NAV}
            title={mode === "month" ? "上个月" : "上一周"}
            onClick={() => go(-1)}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
          </button>

          {mode === "day" ? (
            <div className="grid min-w-0 flex-1 grid-cols-7 gap-1.5">
              {weekDayKeys(shownWeek).map((d) => {
                const picked = d === day;
                const isTodayCell = d === today;
                const count = loadDay(d).entries.length;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDay(d)}
                    className={cn(
                      "flex flex-col items-center rounded-md border py-1.5 leading-tight transition-colors",
                      picked
                        ? "border-ring bg-accent text-foreground"
                        : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[13px] font-medium",
                        isTodayCell && !picked && "text-emerald-500",
                      )}
                    >
                      {weekdayName(d)}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[11px] opacity-60 tabular-nums">
                      {monthDay(d)}
                      {/* 记了几条 —— 补日报时一眼看出哪天是空的 */}
                      {count > 0 && <span>·{count}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="min-w-0 flex-1 text-center text-[14px] text-muted-foreground">
              {mode === "week" ? weekLabel(week) : monthLabel(month)}
            </span>
          )}

          <button
            type="button"
            className={NAV}
            title={mode === "month" ? "下个月" : "下一周"}
            onClick={() => go(1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
          </button>
          {/* 翻远了才出现,而且是绿的 —— 灰色 ghost 混在一排按钮里根本看不见,
              而这颗是"我迷路了,带我回去"的按钮,就该显眼。 */}
          <Button
            variant="outline"
            onClick={() => {
              setDay(today);
              setWeek(thisWeek);
              setMonth(thisMonth);
            }}
            disabled={atNow}
            className={cn(
              "h-9 shrink-0 text-[13px]",
              !atNow &&
                "border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400",
            )}
          >
            回到{mode === "day" ? "今天" : mode === "week" ? "本周" : "本月"}
          </Button>
        </div>

        {/* 主体左右分栏:左边是攒下来的记录,右边是要动笔写的两块 */}
        <div className="flex min-h-0 flex-1 gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 items-center gap-2">
              <span className={LABEL}>做了什么</span>
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
                {(
                  [
                    ["time", mode === "day" ? "按时间" : "按天"],
                    ["kind", "按分类"],
                  ] as const
                ).map(([g, label]) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroup(g)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[12px] transition-colors",
                      group === g
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[12px] text-muted-foreground/50">
                {mode === "day"
                  ? "点一下改,悬停可删"
                  : "属于某一天,点日期回那天改"}
              </span>
            </div>

            {mode === "day" ? (
              dayLog.entries.length === 0 ? (
                <span className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[13px] text-muted-foreground/50">
                  这天还没记过 —— 在最下面那一栏写一条
                </span>
              ) : (
                <div
                  ref={attachList}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1"
                >
                  {group === "time"
                    ? dayLog.entries.map(entryRow)
                    : groupByKind(dayLog.entries).map((g) => (
                        <div
                          key={g.kind ?? "未分类"}
                          className="mb-2 flex flex-col"
                        >
                          <div className="flex items-center gap-2 px-2 py-1">
                            {g.kind ? (
                              <KindTag kind={g.kind} />
                            ) : (
                              <span className="text-[12px] text-muted-foreground/50">
                                未分类
                              </span>
                            )}
                            <span className="text-[12px] text-muted-foreground/40">
                              {g.items.length} 条
                            </span>
                          </div>
                          {g.items.map(entryRow)}
                        </div>
                      ))}
                </div>
              )
            ) : group === "kind" ? (
              // 跨天汇总,每条前面标是哪天 —— 周报/月报多半就照这个抄
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {periodEntries.length === 0 ? (
                  <span className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[13px] text-muted-foreground/50">
                    这{mode === "week" ? "周" : "个月"}还没记过
                  </span>
                ) : (
                  groupByKind(periodEntries).map((g) => (
                    <div key={g.kind ?? "未分类"} className="flex flex-col">
                      <div className="flex items-center gap-2 px-2 py-1">
                        {g.kind ? (
                          <KindTag kind={g.kind} />
                        ) : (
                          <span className="text-[12px] text-muted-foreground/50">
                            未分类
                          </span>
                        )}
                        <span className="text-[12px] text-muted-foreground/40">
                          {g.items.length} 条
                        </span>
                      </div>
                      {g.items.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          title={`回到 ${e.day} 改`}
                          onClick={() => {
                            setMode("day");
                            setDay(e.day);
                          }}
                          className="flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/40"
                        >
                          <span className="w-20 shrink-0 pt-0.5 font-mono text-[12px] text-muted-foreground/60 tabular-nums">
                            {monthDay(e.day)} {weekdayName(e.day)}
                          </span>
                          <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
                            {e.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            ) : (
              // 一行一天:左边一列写星期和日期,右边一列是那天的记录。日期跟内容
              // 各占一列对得齐,扫的时候眼睛不用在缩进里找边界。
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                {dayRows.length === 0 ? (
                  <span className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-[13px] text-muted-foreground/50">
                    这个月还没记过
                  </span>
                ) : (
                  dayRows.map(({ day: d, entries }) => {
                    const isTodayRow = d === today;
                    return (
                      <div
                        key={d}
                        className="flex gap-3 border-b border-border/40 py-1.5 last:border-b-0"
                      >
                        <button
                          type="button"
                          title={`跳到 ${d}`}
                          onClick={() => {
                            setMode("day");
                            setDay(d);
                          }}
                          className={cn(
                            "w-24 shrink-0 self-start rounded px-2 py-1 text-left text-[13px] font-medium hover:bg-accent",
                            isTodayRow
                              ? "text-emerald-500"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {weekdayName(d)}
                          <span className="ml-1.5 font-mono text-[11px] opacity-60 tabular-nums">
                            {monthDay(d)}
                          </span>
                        </button>
                        <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                          {entries.length === 0 ? (
                            <span className="text-[12.5px] text-muted-foreground/30">
                              —
                            </span>
                          ) : (
                            entries.map((e) => (
                              <div
                                key={e.id}
                                className="flex items-start gap-2.5"
                              >
                                <span className="shrink-0 pt-0.5">
                                  <KindTag kind={e.kind} />
                                </span>
                                <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
                                  {e.text}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* 录入就贴在记录下面 —— 它喂的就是上面这个列表,放在左栏里,
                手在"看记录"和"记一条"之间不用横穿整个弹窗。按周不出现:
                记的东西天然属于某一天。 */}
            {mode === "day" && (
              <div className="mt-1 flex shrink-0 flex-col gap-2 border-t border-border/60 pt-3">
                <div className="flex items-center gap-2">
                  <input
                    // biome-ignore lint/a11y/noAutofocus: 这个弹窗就是为了"立刻记一条"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      // 中文输入法里回车是"选中候选词",这一下的 keydown 也叫
                      // Enter。不挡掉的话打拼音打到一半就被提交了,或者候选词被
                      // 吃掉、看着像"回车没反应"。
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") submit();
                    }}
                    placeholder={`刚做完什么?回车记到 ${monthDay(today)} ${weekdayName(today)}`}
                    className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[14px] outline-none focus:border-ring"
                  />
                  <Button
                    onClick={submit}
                    disabled={!draft.trim()}
                    className="h-10 shrink-0 px-5 text-[13.5px]"
                  >
                    记一条
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ENTRY_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                        kind === k
                          ? KIND_TONE[k]
                          : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      {k}
                    </button>
                  ))}
                  <button
                    type="button"
                    title="记完这条就把窗口关掉"
                    onClick={() => {
                      const next = !closeAfter;
                      setCloseAfter(next);
                      setCloseAfterAdd(next);
                    }}
                    className={cn(
                      "ml-auto flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 text-[12px] transition-colors hover:bg-accent",
                      closeAfter
                        ? "text-emerald-500"
                        : "text-muted-foreground/60 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-3.5 items-center justify-center rounded border",
                        closeAfter
                          ? "border-emerald-500 bg-emerald-500/20"
                          : "border-border",
                      )}
                    >
                      {closeAfter && (
                        <HugeiconsIcon
                          icon={Tick01Icon}
                          size={10}
                          strokeWidth={3}
                        />
                      )}
                    </span>
                    记完就关
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右栏定宽:输入框要能读,通栏的一行字扫不过来 */}
          <div className="flex w-[22rem] shrink-0 flex-col gap-4 border-l border-border/60 pl-4">
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <span className={LABEL}>{periodWord}计划</span>
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={
                  mode === "day" ? "今天打算做什么" : "这周打算做什么"
                }
                className={FIELD}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <span className={LABEL}>{periodWord}总结</span>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={
                  mode === "day"
                    ? "今天的结论、卡住的地方"
                    : "这周的结论、下周重点"
                }
                className={FIELD}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
