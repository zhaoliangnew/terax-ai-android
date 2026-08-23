import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  PlusSignIcon,
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
  editEntry,
  entryTime,
  loadDay,
  loadWeek,
  monthDay,
  removeEntry,
  saveWeek,
  setDayField,
  shiftDay,
  shiftWeek,
  type WeekLog,
  weekDayKeys,
  weekdayName,
  weekKeyOf,
  weekLabel,
  weekMarkdown,
} from "./lib/journal";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Mode = "day" | "week";

const FIELD =
  "w-full resize-none rounded border border-input bg-transparent px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-ring";
const LABEL = "text-[12px] font-medium text-muted-foreground";
const NAV =
  "flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/**
 * 日报:随手记一条,到点了拼成日报/周报复制走。
 *
 * 日和周各存各的计划/总结;周视图的"做了什么"不单独记,直接汇总那一周每天的
 * 条目 —— 一件事只记一次,写周报时不用再抄一遍。
 */
export function JournalDialog({ open, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(() => dayKeyOf(new Date()));
  const [week, setWeek] = useState(() => weekKeyOf(new Date()));
  const [dayLog, setDayLog] = useState<DayLog>(() => loadDay(day));
  const [weekLog, setWeekLog] = useState<WeekLog>(() => loadWeek(week));
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );

  // 每次打开都回到今天 —— 上次翻到哪天了不重要,要记的是现在这条。
  useEffect(() => {
    if (!open) return;
    const today = dayKeyOf(new Date());
    setDay(today);
    setWeek(weekKeyOf(new Date()));
    setDraft("");
    setEditing(null);
  }, [open]);

  useEffect(() => setDayLog(loadDay(day)), [day]);
  useEffect(() => setWeekLog(loadWeek(week)), [week]);

  const isToday = day === dayKeyOf(new Date());
  const isThisWeek = week === weekKeyOf(new Date());

  const submit = useCallback(() => {
    if (!draft.trim()) return;
    // 记到"现在"所在的那天,不是当前翻到的那天 —— 翻着历史顺手记一条,
    // 结果落到上周三去,那就麻烦了。
    const now = new Date();
    const today = dayKeyOf(now);
    addEntry(today, draft, now);
    setDraft("");
    if (today === day) setDayLog(loadDay(day));
    else {
      setMode("day");
      setDay(today);
      toast.success("已记到今天", { description: dayLabel(today) });
    }
  }, [draft, day]);

  // 周一到周日七天全列出来,空的也留位置 —— 一眼看出哪天没写,
  // 而不是"这天没记"和"这天不存在"长得一样。
  const weekDays = useMemo(() => {
    if (mode !== "week") return [];
    return weekDayKeys(week).map((d) => ({ day: d, log: loadDay(d) }));
    // dayLog 也进依赖:在日视图刚记完一条切回来,这里得是新的
  }, [mode, week, dayLog]);

  const copy = () => {
    const text = mode === "day" ? dayMarkdown(day) : weekMarkdown(week);
    if (!text.trim()) {
      toast.error("这一" + (mode === "day" ? "天" : "周") + "还什么都没有");
      return;
    }
    void copyToClipboard(text);
    toast.success("已复制", { description: "粘到日报里就行" });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* 铺满大半个窗口:这是个专门用来写东西的弹窗,七列一周、几十条记录都要
          摆得下。固定高度而不是跟着内容长 —— 记两条和记二十条,布局别乱跳。
          日/周同宽同高,切模式时不晃。 */}
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-none flex-col gap-3 sm:max-w-[1400px]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-sm">日报</DialogTitle>
          <DialogDescription className="text-xs">
            做完一件事随手记一条,写日报/周报时一键复制。
          </DialogDescription>
        </DialogHeader>

        {/* 随手记那一栏钉在最上面:打开就能打字,不用先找位置 */}
        <div className="flex items-center gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: 这个弹窗就是为了"立刻记一条"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") submit();
            }}
            placeholder="刚做完什么?回车记下"
            className="h-8 min-w-0 flex-1 rounded border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring"
          />
          <Button size="sm" onClick={submit} className="h-8 shrink-0 text-xs">
            <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={2} />
            记一条
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-0.5 rounded border border-border p-0.5">
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-2 py-0.5 text-[12px] transition-colors",
                  mode === m
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "day" ? "按日" : "按周"}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={NAV}
            title="上一个"
            onClick={() =>
              mode === "day"
                ? setDay(shiftDay(day, -1))
                : setWeek(shiftWeek(week, -1))
            }
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={2} />
          </button>
          <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium">
            {mode === "day" ? `${day} ${weekdayName(day)}` : weekLabel(week)}
          </span>
          <button
            type="button"
            className={NAV}
            title="下一个"
            onClick={() =>
              mode === "day"
                ? setDay(shiftDay(day, 1))
                : setWeek(shiftWeek(week, 1))
            }
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
          </button>
          {!(mode === "day" ? isToday : isThisWeek) && (
            <button
              type="button"
              onClick={() =>
                mode === "day"
                  ? setDay(dayKeyOf(new Date()))
                  : setWeek(weekKeyOf(new Date()))
              }
              className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              回到{mode === "day" ? "今天" : "本周"}
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            title="复制成 Markdown"
            className="h-7 shrink-0 px-2 text-xs"
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
            复制
          </Button>
        </div>

        {/* 按日整块滚;按周不滚,让七列撑满高度、各自内部滚 */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-3 pr-1",
            mode === "day" ? "overflow-y-auto" : "overflow-hidden",
          )}
        >
          <div className="flex flex-col gap-1">
            <span className={LABEL}>计划</span>
            <textarea
              rows={3}
              value={mode === "day" ? dayLog.plan : weekLog.plan}
              onChange={(e) => {
                const v = e.target.value;
                if (mode === "day") setDayLog(setDayField(day, "plan", v));
                else setWeekLog(saveWeek(week, { ...weekLog, plan: v }));
              }}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={mode === "day" ? "今天打算做什么" : "这周打算做什么"}
              className={FIELD}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <span className={LABEL}>做了什么</span>
            {mode === "day" ? (
              dayLog.entries.length === 0 ? (
                <span className="px-1 py-2 text-[12px] text-muted-foreground/60">
                  还没记过
                </span>
              ) : (
                <div className="flex flex-col">
                  {dayLog.entries.map((e) => (
                    <div
                      key={e.id}
                      className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-accent/40"
                    >
                      <span className="shrink-0 pt-px font-mono text-[11px] text-muted-foreground/60 tabular-nums">
                        {entryTime(e.at)}
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
                          className="min-w-0 flex-1 rounded border border-input bg-transparent px-1 text-[13px] outline-none focus:border-ring"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: e.id, text: e.text })}
                          className="min-w-0 flex-1 text-left text-[13px] leading-relaxed"
                        >
                          {e.text}
                        </button>
                      )}
                      <button
                        type="button"
                        title="删除"
                        onClick={() => setDayLog(removeEntry(day, e.id))}
                        className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          size={12}
                          strokeWidth={1.75}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              // 周视图只读:条目属于某一天,要改回那天改,免得同一条在两处能编辑。
              // 七天平铺成七列,一眼看完一周 —— 竖着排要滚,还看不出哪天空着。
              <div className="grid min-h-0 flex-1 grid-cols-7 gap-1.5">
                {weekDays.map(({ day: d, log }) => {
                  const today = d === dayKeyOf(new Date());
                  return (
                    <div
                      key={d}
                      className={cn(
                        "flex min-w-0 flex-col gap-1 overflow-y-auto rounded border p-1.5",
                        today
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
                          "flex flex-col items-start leading-tight",
                          today
                            ? "text-emerald-500"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span className="text-[12px] font-medium">
                          {weekdayName(d)}
                        </span>
                        <span className="font-mono text-[10px] opacity-60 tabular-nums">
                          {monthDay(d)}
                        </span>
                      </button>
                      {log.entries.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground/30">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {log.entries.map((e) => (
                            <span
                              key={e.id}
                              title={`${entryTime(e.at)} ${e.text}`}
                              className="break-words text-[12px] leading-snug"
                            >
                              {e.text}
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

          <div className="flex flex-col gap-1">
            <span className={LABEL}>总结</span>
            <textarea
              rows={4}
              value={mode === "day" ? dayLog.summary : weekLog.summary}
              onChange={(e) => {
                const v = e.target.value;
                if (mode === "day") setDayLog(setDayField(day, "summary", v));
                else setWeekLog(saveWeek(week, { ...weekLog, summary: v }));
              }}
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
      </DialogContent>
    </Dialog>
  );
}
