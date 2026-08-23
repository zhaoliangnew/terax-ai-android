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
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addEntry,
  type DayLog,
  dayKeyOf,
  dayLabel,
  dayMarkdown,
  ENTRY_KINDS,
  type EntryKind,
  editEntry,
  entryTime,
  lastKind,
  loadDay,
  loadWeek,
  monthDay,
  removeEntry,
  saveWeek,
  setDayField,
  shiftWeek,
  type WeekLog,
  weekDayKeys,
  weekdayName,
  weekKeyOf,
  weekLabel,
  weekMarkdown,
  weekOfDay,
} from "./lib/journal";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Mode = "day" | "week";

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
 *    (要动笔写,所以给它一个能读的行宽 —— 1400px 通栏的输入框没法写字);
 *  - 录入固定在最底下,输入框+类型+按钮是一整块,跟聊天框一个位置感。
 *
 * 日和周各存各的计划/总结;周的"做了什么"不单独记,直接汇总那一周每天的条目
 * —— 一件事只记一次,写周报时不用再抄一遍。
 */
export function JournalDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(() => dayKeyOf(new Date()));
  const [week, setWeek] = useState(() => weekKeyOf(new Date()));
  const [dayLog, setDayLog] = useState<DayLog>(() => loadDay(day));
  const [weekLog, setWeekLog] = useState<WeekLog>(() => loadWeek(week));
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<EntryKind>(() => lastKind());
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );

  // 每次打开都回到今天 —— 上次翻到哪天了不重要,要记的是现在这条。
  useEffect(() => {
    if (!open) return;
    setDay(dayKeyOf(new Date()));
    setWeek(weekKeyOf(new Date()));
    setDraft("");
    setKind(lastKind());
    setEditing(null);
  }, [open]);

  useEffect(() => setDayLog(loadDay(day)), [day]);
  useEffect(() => setWeekLog(loadWeek(week)), [week]);

  const today = dayKeyOf(new Date());
  const thisWeek = weekKeyOf(new Date());
  // 按日时上下翻的也是"周" —— 一排星期直接点哪天,箭头只管换周,一套控件说清楚
  const shownWeek = mode === "day" ? weekOfDay(day) : week;
  const atNow = mode === "day" ? day === today : week === thisWeek;

  const goWeek = (delta: number) => {
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
    if (key === day) setDayLog(loadDay(day));
    else {
      setMode("day");
      setDay(key);
      toast.success("已记到今天", { description: dayLabel(key) });
    }
  }, [draft, day, kind]);

  // 周一到周日七天全列出来,空的也留位置 —— 一眼看出哪天没写,
  // 而不是"这天没记"和"这天不存在"长得一样。
  const weekDays = useMemo(() => {
    if (mode !== "week") return [];
    return weekDayKeys(week).map((d) => ({ day: d, log: loadDay(d) }));
    // dayLog 同上:在日视图刚记完一条,切回按周这里得是新的
    // biome-ignore lint/correctness/useExhaustiveDependencies: dayLog 是重算信号
  }, [mode, week, dayLog]);

  const copy = () => {
    const text = mode === "day" ? dayMarkdown(day) : weekMarkdown(week);
    if (!text.trim()) {
      toast.error(`这一${mode === "day" ? "天" : "周"}还什么都没有`);
      return;
    }
    void copyToClipboard(text);
    toast.success("已复制", { description: "粘到日报里就行" });
  };

  const plan = mode === "day" ? dayLog.plan : weekLog.plan;
  const summary = mode === "day" ? dayLog.summary : weekLog.summary;
  const setPlan = (v: string) => {
    if (mode === "day") setDayLog(setDayField(day, "plan", v));
    else setWeekLog(saveWeek(week, { ...weekLog, plan: v }));
  };
  const setSummary = (v: string) => {
    if (mode === "day") setDayLog(setDayField(day, "summary", v));
    else setWeekLog(saveWeek(week, { ...weekLog, summary: v }));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-none flex-col gap-0 p-0 sm:max-w-[1400px]">
        {/* 顶栏:是日还是周、看的哪一天、怎么翻 —— 一行说完 */}
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="shrink-0 text-lg font-semibold">
              {mode === "day" ? "日报" : "周报"}
            </DialogTitle>
            <span className="min-w-0 truncate text-[15px] text-muted-foreground">
              {mode === "day" ? `${day} ${weekdayName(day)}` : weekLabel(week)}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
                {(["day", "week"] as const).map((m) => (
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
                    {m === "day" ? "按日" : "按周"}
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
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-2.5">
          <button
            type="button"
            className={NAV}
            title="上一周"
            onClick={() => goWeek(-1)}
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
              {weekLabel(week)}
            </span>
          )}

          <button
            type="button"
            className={NAV}
            title="下一周"
            onClick={() => goWeek(1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
          </button>
          <Button
            variant="ghost"
            onClick={() => {
              setDay(today);
              setWeek(thisWeek);
            }}
            disabled={atNow}
            className="h-9 shrink-0 text-[13px]"
          >
            回到{mode === "day" ? "今天" : "本周"}
          </Button>
        </div>

        {/* 主体左右分栏:左边是攒下来的记录,右边是要动笔写的两块 */}
        <div className="flex min-h-0 flex-1 gap-5 px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 items-baseline gap-2">
              <span className={LABEL}>做了什么</span>
              <span className="text-[12px] text-muted-foreground/50">
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
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                  {dayLog.entries.map((e) => (
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
                          onChange={(ev) =>
                            setEditing({ id: e.id, text: ev.target.value })
                          }
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
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              // 七天平铺成七列,一眼看完一周;竖着排要滚,还看不出哪天空着
              <div className="grid min-h-0 flex-1 grid-cols-7 gap-2">
                {weekDays.map(({ day: d, log }) => {
                  const isTodayCol = d === today;
                  return (
                    <div
                      key={d}
                      className={cn(
                        "flex min-w-0 flex-col gap-2 overflow-y-auto rounded-md border p-2",
                        isTodayCol
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-border/60",
                      )}
                    >
                      <button
                        type="button"
                        title={`跳到 ${d}`}
                        onClick={() => {
                          setMode("day");
                          setDay(d);
                        }}
                        className={cn(
                          "flex shrink-0 flex-col items-start leading-tight",
                          isTodayCol
                            ? "text-emerald-500"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span className="text-[13px] font-medium">
                          {weekdayName(d)}
                        </span>
                        <span className="font-mono text-[11px] opacity-60 tabular-nums">
                          {monthDay(d)}
                        </span>
                      </button>
                      {log.entries.length === 0 ? (
                        <span className="text-[12px] text-muted-foreground/30">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {log.entries.map((e) => (
                            <span
                              key={e.id}
                              title={`${entryTime(e.at)} ${e.kind ?? ""} ${e.text}`}
                              className="flex flex-col items-start gap-1"
                            >
                              <KindTag kind={e.kind} />
                              <span className="break-words text-[12.5px] leading-snug">
                                {e.text}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 右栏定宽:输入框要能读,1400px 通栏的一行字扫不过来 */}
          <div className="flex w-[30rem] shrink-0 flex-col gap-4 border-l border-border/60 pl-5">
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <span className={LABEL}>计划</span>
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
              <span className={LABEL}>总结</span>
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

        {/* 录入固定在最底下,自成一块:上面是"看",这里是"写"。
            只在按日出现 —— 记的东西天然属于某一天,按周是拿来汇总和写总结的,
            摆个"记到今天"的输入框在那儿只会让人愣一下。 */}
        {mode === "day" && (
          <div className="shrink-0 border-t border-border bg-foreground/[0.03] px-5 py-3">
            <div className="flex items-center gap-3">
              <input
                // biome-ignore lint/a11y/noAutofocus: 这个弹窗就是为了"立刻记一条"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") submit();
                }}
                placeholder={`刚做完什么?回车记到 ${monthDay(today)} ${weekdayName(today)}`}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[14px] outline-none focus:border-ring"
              />
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {ENTRY_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
                      kind === k
                        ? KIND_TONE[k]
                        : "border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <Button
                onClick={submit}
                disabled={!draft.trim()}
                className="h-10 shrink-0 px-5 text-[13.5px]"
              >
                记一条
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
