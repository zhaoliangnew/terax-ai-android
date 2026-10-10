import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Tick02Icon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatItem } from "../lib/chatItems";
import {
  parseWorkflowJournal,
  parseWorkflowMeta,
  settleJournal,
  type WorkflowAgentStatus,
  type WorkflowJournal,
  type WorkflowMeta,
  workflowPhases,
  workflowRunDir,
  workflowScriptFile,
} from "../lib/workflowProgress";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const POLL_MS = 1500;
const EMPTY: WorkflowJournal = { agents: [], phasesSeen: [] };

/**
 * 各代理第一次在 journal 里出现/结束的时刻(journal 本身不带时间)。放在
 * 模块级、按运行目录分:折叠展开过程、切会话会让卡片重新挂载,时间不能丢。
 */
const agentTimes = new Map<
  string,
  Map<string, { start?: number; end?: number }>
>();

function timesFor(dir: string) {
  let m = agentTimes.get(dir);
  if (!m) {
    m = new Map();
    agentTimes.set(dir, m);
  }
  return m;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}小时${m % 60}分`;
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

/**
 * 脚本里的 meta:优先读 scriptPath 指的文件(内联脚本和它同时给时以文件为准);
 * 只有内联脚本就直接解析;按名字跑的 saved workflow,从工具结果的
 * "Script file:" 读。
 */
function useMeta(item: ToolItem): WorkflowMeta {
  const input = item.input;
  const script = typeof input.script === "string" ? input.script : "";
  const named = typeof input.name === "string" ? input.name : "";
  const scriptPath =
    (typeof input.scriptPath === "string" && input.scriptPath) ||
    (!script && item.result ? workflowScriptFile(item.result.text) : null) ||
    "";
  const [fromFile, setFromFile] = useState<WorkflowMeta | null>(null);
  useEffect(() => {
    if (!scriptPath) return;
    let alive = true;
    native
      .readFile(scriptPath)
      .then((r) => {
        if (alive && r.kind === "text")
          setFromFile(parseWorkflowMeta(r.content));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [scriptPath]);
  return useMemo(() => {
    const m =
      fromFile ??
      (script
        ? parseWorkflowMeta(script)
        : { name: "", description: "", phases: [] });
    return { ...m, name: m.name || named || "workflow" };
  }, [script, fromFile, named]);
}

/**
 * 跟着运行目录的 journal.jsonl 走:跑着的时候每 1.5 秒读一次;结束(或者
 * 状态变了)时再读一次,保证最后一眼是全的。只有亲眼看着跑的代理才记时间,
 * 翻旧会话时已经跑完的不知道用了多久。
 */
function useJournal(dir: string | null, live: boolean, version: string) {
  const [journal, setJournal] = useState<WorkflowJournal>(EMPTY);
  const [tooLarge, setTooLarge] = useState(false);
  const lastLen = useRef(-1);
  const liveRef = useRef(live);
  liveRef.current = live;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version 只是"状态变了,再读一次"的信号
  useEffect(() => {
    if (!dir) return;
    let alive = true;
    const times = timesFor(dir);
    const read = () => {
      native
        .readFile(`${dir}/journal.jsonl`)
        .then((r) => {
          if (!alive) return;
          if (r.kind === "toolarge") {
            setTooLarge(true);
            return;
          }
          if (r.kind !== "text") return;
          if (r.content.length === lastLen.current) return;
          lastLen.current = r.content.length;
          const j = parseWorkflowJournal(r.content);
          const now = Date.now();
          for (const a of j.agents) {
            const t = times.get(a.id) ?? {};
            if (t.start === undefined && liveRef.current) t.start = now;
            if (a.status !== "running" && t.end === undefined && t.start)
              t.end = now;
            times.set(a.id, t);
          }
          setJournal(j);
        })
        .catch(() => {});
    };
    read();
    if (!live)
      return () => {
        alive = false;
      };
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [dir, live, version]);
  return { journal, tooLarge, times: dir ? timesFor(dir) : null };
}

/** 聊天里的 Workflow 工具:照 /workflows 面板画阶段和各代理的进度。 */
export function WorkflowCard({
  item,
  running,
}: {
  item: ToolItem;
  running: boolean;
}) {
  const meta = useMeta(item);
  const dir = item.result ? workflowRunDir(item.result.text) : null;
  const task = item.task;
  const live = task ? task.status === "running" : running && !item.result;
  const {
    journal: raw,
    tooLarge,
    times,
  } = useJournal(dir, live, task?.status ?? "");
  // 结束了还标着在跑的代理:没跑完,不再闪
  const journal = settleJournal(raw, !live);
  const now = useNow(live);
  const phases = workflowPhases(meta, journal);
  const count = (s: WorkflowAgentStatus) =>
    journal.agents.filter((a) => a.status === s).length;
  const done = count("done");
  const failed = count("failed");
  const stopped = count("stopped");
  const total = journal.agents.length;
  const elapsed = task
    ? Math.max(task.durationMs ?? 0, live ? now - task.startedAt : 0)
    : 0;
  const took = elapsed ? ` · ${fmt(elapsed)}` : "";

  // 默认看正在跑的那个阶段,没有就看最后一个有代理的阶段;点了就跟着点的,
  // 点回自动跟的那个就恢复自动跟
  const auto =
    phases.find((p) => p.state === "running")?.title ??
    [...phases].reverse().find((p) => p.total > 0)?.title ??
    phases[0]?.title ??
    "";
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? auto;
  const agents = journal.agents.filter((a) => a.phase === current);
  const [showRaw, setShowRaw] = useState(false);

  const failedRun = task?.status === "failed" || !!item.result?.isError;
  const unfinished = failed + stopped;
  const statusText = live
    ? `运行中 · ${done + failed}/${total || "…"} 个代理${took}`
    : failedRun
      ? `失败${total ? ` · ${done}/${total} 个代理完成` : ""}${took}`
      : task?.status === "stopped"
        ? `已停止 · ${done}/${total} 个代理完成${took}`
        : // 没有任务信息(翻旧会话):只说结束了,看不出是不是顺利跑完
          `${task ? "完成" : "已结束"} · ${total} 个代理${unfinished ? `(${unfinished} 个没跑完)` : ""}${took}`;

  return (
    <div className="@container mt-0.5 overflow-hidden rounded-xl border border-border/70 bg-foreground/[0.025]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/50 px-3 py-2">
        <HugeiconsIcon
          icon={WorkflowSquare03Icon}
          size={14}
          strokeWidth={1.75}
          className="shrink-0 text-[#b48cf7]"
        />
        <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-foreground/90">
          {meta.name}
        </span>
        {meta.description && (
          <span
            title={meta.description}
            className="min-w-0 flex-1 basis-24 truncate text-[11.5px] text-muted-foreground/70"
          >
            {meta.description}
          </span>
        )}
        <span className="ml-auto">
          {live ? (
            <Shimmer className="text-[11.5px]">{statusText}</Shimmer>
          ) : (
            <span
              className={cn(
                "text-[11.5px]",
                failedRun ? "text-red-400" : "text-muted-foreground/70",
              )}
            >
              {statusText}
            </span>
          )}
        </span>
      </div>
      {/* SDK 结束时给的一句总结;失败时就是原因 */}
      {task?.summary && !live && (
        <div
          className={cn(
            "border-b border-border/50 px-3 py-1.5 text-[11.5px] leading-snug",
            failedRun ? "text-red-400" : "text-muted-foreground/80",
          )}
        >
          {task.summary}
        </div>
      )}
      {tooLarge ? (
        <div className="px-3 py-2 text-[11.5px] text-muted-foreground/70">
          运行记录太大(超过 10MB),这里不显示进度了;用 /workflows 看
        </div>
      ) : phases.length > 0 ? (
        // 窄的时候阶段摞在上面,宽了才左右排
        <div className="flex min-h-0 flex-col @md:flex-row">
          {/* 阶段 */}
          <div className="flex shrink-0 flex-col gap-0.5 border-b border-border/50 p-1.5 @md:w-44 @md:border-r @md:border-b-0">
            {phases.map((p, i) => (
              <button
                key={p.title || "_"}
                type="button"
                onClick={() => setPicked(p.title === auto ? null : p.title)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                  p.title === current
                    ? "bg-foreground/[0.08] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.05]",
                )}
              >
                <PhaseMark state={p.state} index={i + 1} failed={p.failed} />
                <span className="min-w-0 flex-1 truncate">
                  {p.title || "未分阶段"}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60 tabular-nums">
                  {p.done}/{p.total}
                </span>
              </button>
            ))}
          </div>
          {/* 选中阶段的代理 */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-1.5">
            {agents.length === 0 ? (
              <div className="px-2 py-1 text-[11.5px] text-muted-foreground/60">
                {live ? "还没开始" : "这个阶段没有代理"}
              </div>
            ) : (
              agents.map((a) => {
                const t = times?.get(a.id);
                const ms =
                  t?.start !== undefined
                    ? (t.end ?? (a.status === "running" ? now : t.start)) -
                      t.start
                    : null;
                return (
                  <div
                    key={a.id}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-[12px]"
                  >
                    <AgentMark status={a.status} />
                    <span
                      title={a.label}
                      className={cn(
                        "min-w-0 flex-1 truncate font-mono text-[11.5px]",
                        a.status === "running"
                          ? "text-foreground"
                          : "text-foreground/75",
                      )}
                    >
                      {a.label}
                    </span>
                    {a.status === "failed" && (
                      <span className="shrink-0 text-[11px] text-red-400">
                        没跑成
                      </span>
                    )}
                    {a.status === "stopped" && (
                      <span className="shrink-0 text-[11px] text-muted-foreground/60">
                        没跑完
                      </span>
                    )}
                    {ms !== null && ms > 0 && (
                      <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
                        {fmt(ms)}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 py-2 text-[11.5px] text-muted-foreground/70">
          {live ? "正在启动…" : "没有读到进度"}
        </div>
      )}
      {item.result?.text && (
        <div className="border-t border-border/50">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex cursor-pointer items-center gap-1 px-3 py-1 text-[11px] text-muted-foreground/60 hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={10}
              strokeWidth={2.25}
              className={cn("transition-transform", showRaw && "rotate-90")}
            />
            工具返回
          </button>
          {showRaw && (
            <div className="max-h-56 overflow-auto px-3 pb-2 font-mono text-[11px] whitespace-pre-wrap break-all text-muted-foreground">
              {item.result.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseMark({
  state,
  index,
  failed,
}: {
  state: "pending" | "running" | "done";
  index: number;
  failed: number;
}) {
  if (state === "done")
    return (
      <HugeiconsIcon
        icon={failed ? Cancel01Icon : Tick02Icon}
        size={12}
        strokeWidth={2.25}
        className={cn(
          "shrink-0",
          failed ? "text-amber-500" : "text-emerald-500",
        )}
      />
    );
  if (state === "running")
    return (
      <span className="flex size-3 shrink-0 items-center justify-center">
        <span className="size-1.5 animate-pulse rounded-full bg-[#6f9ce8]" />
      </span>
    );
  return (
    <span className="w-3 shrink-0 text-center font-mono text-[10.5px] text-muted-foreground/50">
      {index}
    </span>
  );
}

function AgentMark({ status }: { status: WorkflowAgentStatus }) {
  if (status === "done")
    return (
      <HugeiconsIcon
        icon={Tick02Icon}
        size={12}
        strokeWidth={2.25}
        className="shrink-0 text-emerald-500"
      />
    );
  if (status === "failed")
    return (
      <HugeiconsIcon
        icon={Cancel01Icon}
        size={12}
        strokeWidth={2.25}
        className="shrink-0 text-red-400"
      />
    );
  if (status === "stopped")
    return (
      <span className="flex size-3 shrink-0 items-center justify-center">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
      </span>
    );
  return (
    <span className="flex size-3 shrink-0 items-center justify-center">
      <span className="size-1.5 animate-pulse rounded-full bg-[#6f9ce8]" />
    </span>
  );
}
