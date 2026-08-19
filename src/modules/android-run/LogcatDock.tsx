import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowDown02Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readApplicationId } from "./lib/adb";
import { killAllLogcatSessions, useLogcatStore } from "./logcatStore";
import { useActiveProductConfig } from "./store";

const LEVELS = ["V", "D", "I", "W", "E"] as const;
const PRESET_TAGS = ["leniu-info", "leniu-http", "leniu-mqtt", "leniu-error"];
type Level = (typeof LEVELS)[number];

const LEVEL_TEXT: Record<Level, string> = {
  V: "text-muted-foreground",
  D: "text-sky-500",
  I: "text-emerald-500",
  W: "text-yellow-500",
  E: "text-red-500",
};

// threadtime: "MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG    : message"
const LINE_RE =
  /^(\d{2}-\d{2}\s+[\d:.]+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:\s?(.*)$/;

type ParsedLine = {
  raw: string;
  ts: string | null;
  pid: string | null;
  level: Level | null;
  tag: string | null;
  msg: string;
};

function parseLine(raw: string): ParsedLine {
  const m = LINE_RE.exec(raw);
  if (!m) return { raw, ts: null, pid: null, level: null, tag: null, msg: raw };
  const level = (m[4] === "F" ? "E" : m[4]) as Level;
  return { raw, ts: m[1], pid: m[2], level, tag: m[5], msg: m[6] };
}

export default function LogcatDock() {
  const {
    root: projectRoot,
    serial: selectedSerial,
    module: selectedModule,
  } = useActiveProductConfig();

  const allSessions = useLogcatStore((s) => s.sessions);
  const activeSessionId = useLogcatStore((s) => s.activeSessionId);
  const startSession = useLogcatStore((s) => s.startSession);
  const closeSession = useLogcatStore((s) => s.closeSession);
  const setActiveSession = useLogcatStore((s) => s.setActiveSession);
  const clearSession = useLogcatStore((s) => s.clearSession);
  const togglePause = useLogcatStore((s) => s.togglePause);
  const pollAll = useLogcatStore((s) => s.pollAll);

  // Only this product's sessions are shown; processes for other products keep
  // running in the background but their tabs are hidden.
  const sessions = allSessions.filter((s) => s.product === projectRoot);

  const [filter, setFilter] = useState("");
  const [hiddenLevels, setHiddenLevels] = useState<Set<Level>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  // Active session must belong to the current product; else fall to its last.
  const active =
    sessions.find((s) => s.id === activeSessionId) ??
    sessions[sessions.length - 1] ??
    null;

  // Poll loop (always on; sessions of hidden products keep updating too).
  useEffect(() => {
    const timer = setInterval(() => void pollAll(), 400);
    return () => clearInterval(timer);
  }, [pollAll]);

  // Kill child processes when the window goes away.
  useEffect(() => killAllLogcatSessions, []);

  // First time a product has no sessions: default to its package logcat.
  const startingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!projectRoot || !selectedSerial || sessions.length > 0) return;
    if (startingRef.current.has(projectRoot)) return;
    startingRef.current.add(projectRoot);
    void (async () => {
      let pkg: string | null = null;
      if (selectedModule) {
        pkg = await readApplicationId(projectRoot, selectedModule);
      }
      await startSession(projectRoot, selectedSerial, pkg);
      startingRef.current.delete(projectRoot);
    })();
  }, [
    projectRoot,
    sessions.length,
    selectedSerial,
    selectedModule,
    startSession,
  ]);

  const visibleLines = useMemo(() => {
    if (!active) return [];
    const needle = filter.trim().toLowerCase();
    const parsed = active.lines.map(parseLine);
    const filtered = parsed.filter((l) => {
      if (l.level && hiddenLevels.has(l.level)) return false;
      if (activeTags.size > 0 && !(l.tag && activeTags.has(l.tag)))
        return false;
      if (!needle) return true;
      return l.raw.toLowerCase().includes(needle);
    });
    return filtered.slice(-400);
  }, [active, filter, hiddenLevels, activeTags]);

  // Auto-scroll to bottom unless paused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleLines drives the scroll on every new batch
  useEffect(() => {
    if (active?.paused) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLines, active?.paused]);

  const addPackageSession = useCallback(async () => {
    if (!selectedSerial || !projectRoot) return;
    let pkg: string | null = null;
    if (selectedModule) {
      pkg = await readApplicationId(projectRoot, selectedModule);
    }
    void startSession(projectRoot, selectedSerial, pkg);
  }, [selectedSerial, projectRoot, selectedModule, startSession]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* tab strip */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSession(s.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[11px]",
              s.id === activeSessionId
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={s.label}
          >
            <span className="whitespace-nowrap">{s.label}</span>
            {s.exited &&
              (s.serial === "" ? (
                s.exitCode === 0 ? (
                  <span className="text-[9px] text-emerald-500">完成</span>
                ) : (
                  <span className="text-[9px] text-red-500">
                    失败{s.exitCode != null ? ` (${s.exitCode})` : ""}
                  </span>
                )
              ) : s.pkg ? (
                <span className="text-[9px] text-yellow-500">等待进程…</span>
              ) : (
                <span className="text-[9px] text-red-500">已退出</span>
              ))}
            {/* biome-ignore lint/a11y/useSemanticElements: a <button> cannot nest inside the tab button */}
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
              onKeyDown={() => {}}
              className="opacity-50 hover:opacity-100"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void addPackageSession()}
          className="px-2 py-1 text-muted-foreground hover:text-foreground"
          title="新建日志会话(当前产品包名)"
        >
          +
        </button>
        <div className="flex-1" />
        {/* filter + level chips */}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤(子串匹配)"
          spellCheck={false}
          className="h-6 w-52 rounded-md border border-input bg-transparent px-2 font-mono text-[11px] outline-none focus:border-ring"
        />
        <div className="ml-1 flex items-center gap-0.5">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() =>
                setHiddenLevels((prev) => {
                  const next = new Set(prev);
                  if (next.has(lv)) next.delete(lv);
                  else next.add(lv);
                  return next;
                })
              }
              className={cn(
                "size-5 rounded border border-border font-mono text-[10px] font-bold",
                LEVEL_TEXT[lv],
                hiddenLevels.has(lv) && "opacity-25",
              )}
              title={`显示/隐藏 ${lv} 级日志`}
            >
              {lv}
            </button>
          ))}
        </div>{" "}
      </div>

      {/* preset tag chips */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        {PRESET_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() =>
              setActiveTags((prev) => {
                const next = new Set(prev);
                if (next.has(tag)) next.delete(tag);
                else next.add(tag);
                return next;
              })
            }
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[10px]",
              activeTags.has(tag)
                ? tag === "leniu-error"
                  ? "border-red-500/60 bg-red-500/15 text-red-500"
                  : "border-emerald-500/60 bg-emerald-500/15 text-emerald-500"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            title={`只看 tag=${tag} 的日志(可多选)`}
          >
            {tag}
          </button>
        ))}
        {activeTags.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveTags(new Set())}
            className="px-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            清除
          </button>
        )}
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-border py-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            title="清空"
            onClick={() => active && clearSession(active.id)}
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-6 text-muted-foreground",
              active?.paused && "text-yellow-500",
            )}
            title={active?.paused ? "恢复滚动" : "暂停滚动"}
            onClick={() => active && togglePause(active.id)}
          >
            <HugeiconsIcon
              icon={active?.paused ? PlayIcon : PauseIcon}
              size={13}
              strokeWidth={1.75}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            title="跳到底部"
            onClick={() => {
              const el = bodyRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <HugeiconsIcon
              icon={ArrowDown02Icon}
              size={13}
              strokeWidth={1.75}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            title="复制全部(当前过滤结果)"
            onClick={() => {
              void navigator.clipboard.writeText(
                visibleLines.map((l) => l.raw).join("\n"),
              );
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
          </Button>
        </div>

        <div
          ref={bodyRef}
          className="select-text min-w-0 flex-1 cursor-text overflow-auto py-1 font-mono text-[11px] leading-relaxed"
        >
          {active?.error && (
            <div className="px-3 py-1 text-red-500">
              启动失败:{active.error}
            </div>
          )}
          {visibleLines.map((l, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only stream rows
              key={i}
              className={cn(
                "flex gap-2 whitespace-pre px-3 hover:bg-accent/50",
                l.level === "E" && "bg-red-500/10",
              )}
            >
              {l.ts && (
                <span className="shrink-0 text-muted-foreground">{l.ts}</span>
              )}
              {l.pid && (
                <span className="shrink-0 text-muted-foreground">{l.pid}</span>
              )}
              {l.level && (
                <span className={cn("shrink-0 font-bold", LEVEL_TEXT[l.level])}>
                  {l.level}
                </span>
              )}
              {l.tag && (
                <span
                  className={cn(
                    "w-40 shrink-0 truncate",
                    l.level === "E" ? "text-red-500" : "text-foreground/80",
                  )}
                >
                  {l.tag}
                </span>
              )}
              <span
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-all",
                  l.level === "E" && "text-red-500",
                  l.level === "W" && "text-yellow-500",
                )}
              >
                {l.msg}
              </span>
            </div>
          ))}
          {active && visibleLines.length === 0 && !active.error && (
            <div className="px-3 py-1 text-muted-foreground">等待日志…</div>
          )}
        </div>
      </div>
    </div>
  );
}
