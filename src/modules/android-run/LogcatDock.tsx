import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { highlightSerial } from "./lib/highlightSerial";
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

// threadtime: "MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG    : message". The date
// is dropped from the captured timestamp — every line is effectively "today"
// in a live logcat stream, so it's just noise pushing the message off-screen.
const LINE_RE =
  /^\d{2}-\d{2}\s+([\d:.]+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*:\s?(.*)$/;

type ParsedLine = {
  raw: string;
  ts: string | null;
  pid: string | null;
  level: Level | null;
  tag: string | null;
  msg: string;
};

type JsonSpan = { prefix: string; json: string; suffix: string };

// Common section markers in this app's log lines — break onto their own line
// wherever they show up, so a request URL / headers blob isn't one long run.
const SECTION_MARKERS = [
  "请求数据:",
  "返回数据:",
  "消息头",
  "x-trace-id:",
  "http://",
  "https://",
];

/** Best-effort readability pass over the plain text around an embedded JSON
 * payload: breaks known section markers onto their own line, and expands an
 * inline `key:value,key:value,...` run (e.g. a header blob) into one line
 * per pair. Not a real parser for this app's ad-hoc log format — just enough
 * structure to stop it reading as one dense wall of text. */
function structureFreeText(text: string): string {
  let out = text;
  for (const marker of SECTION_MARKERS) out = out.split(marker).join(`\n${marker}`);
  return out
    .split("\n")
    .map((line) => {
      const kvHits = (line.match(/[\w-]{2,}\s*:/g) ?? []).length;
      if (line.includes(",") && kvHits >= 2) {
        return line
          .split(",")
          .map((seg) => `  ${seg.trim()}`)
          .join("\n");
      }
      return line;
    })
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// This app's own log lines mark the payload with one of these — anchoring on
// the keyword is more reliable than guessing from brackets alone, especially
// once the payload runs past Android logcat's ~4KB per-entry limit and gets
// truncated mid-JSON (bracket-matching then either fails outright or, worse,
// silently latches onto a small valid fragment buried inside and hides the
// rest of the — still useful, if incomplete — truncated payload).
const DATA_MARKERS = ["返回数据:", "请求数据:"];
const DATA_END_MARKERS = [",x-trace-id:", "x-trace-id:"];

function extractJsonAfterMarker(text: string): JsonSpan | null {
  for (const marker of DATA_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    const dataStart = idx + marker.length;
    let dataEnd = text.length;
    for (const end of DATA_END_MARKERS) {
      const endIdx = text.indexOf(end, dataStart);
      if (endIdx !== -1) dataEnd = Math.min(dataEnd, endIdx);
    }
    const candidate = text.slice(dataStart, dataEnd).trim();
    if (!candidate) continue;
    return {
      prefix: text.slice(0, dataStart),
      json: candidate,
      suffix: text.slice(dataEnd),
    };
  }
  return null;
}

/** Finds the first balanced `{...}`/`[...]` substring in `text` that parses
 * as JSON. Generic fallback for lines that don't use this app's own
 * "请求数据:"/"返回数据:" markers. */
function extractJsonByBrackets(text: string): JsonSpan | null {
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== "{" && open !== "[") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(i, j + 1);
          try {
            JSON.parse(candidate);
            return {
              prefix: text.slice(0, i),
              json: candidate,
              suffix: text.slice(j + 1),
            };
          } catch {
            break; // not valid JSON from this start; try the next `{`/`[`
          }
        }
      }
    }
  }
  return null;
}

/** Log lines often mix plain text (request URL, trace-id, ...) with an
 * embedded JSON payload (e.g. "请求返回:https://...,返回数据:{...},
 * x-trace-id:..."). Returns the text before/after the JSON too, so callers
 * can show the full line with just the JSON part pretty-printed — `json`
 * may not be valid JSON on its own if the source line was truncated;
 * callers should render it as-is (not pretty-printed) when it fails to
 * parse rather than dropping it. Returns null if no JSON payload is found. */
function extractJson(text: string): JsonSpan | null {
  return extractJsonAfterMarker(text) ?? extractJsonByBrackets(text);
}

/** Pretty-prints a JSON candidate; falls back to the raw text (and reports
 * `ok: false`) when it doesn't parse — e.g. the source log line got
 * truncated mid-payload by Android logcat's per-entry size limit. */
function prettyJson(candidate: string): { text: string; ok: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(candidate), null, 2), ok: true };
  } catch {
    return { text: candidate, ok: false };
  }
}

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
  const [jsonDialog, setJsonDialog] = useState<JsonSpan | null>(null);
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
              "flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 text-[12px]",
              s.id === activeSessionId
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={s.label}
          >
            <span className="whitespace-nowrap">
              {(() => {
                const idx = s.serial ? s.label.indexOf(s.serial) : -1;
                if (idx === -1) return s.label;
                return (
                  <>
                    {s.label.slice(0, idx)}
                    {highlightSerial(s.serial)}
                    {s.label.slice(idx + s.serial.length)}
                  </>
                );
              })()}
            </span>
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
          className="select-text min-w-0 flex-1 cursor-text overflow-auto py-1 font-mono text-[11px] leading-relaxed [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {active?.error && (
            <div className="px-3 py-1 text-red-500">
              启动失败:{active.error}
            </div>
          )}
          {visibleLines.map((l, i) => {
            const json = extractJson(l.msg);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only stream rows
                key={i}
                className={cn(
                  "group flex whitespace-pre hover:bg-accent/50",
                  l.level === "E" && "bg-red-500/10",
                )}
              >
                {/* Sticky gutter: metadata + JSON button stay put while a
                    long message scrolls horizontally underneath. */}
                <div
                  className={cn(
                    "sticky left-0 z-10 flex shrink-0 gap-2 bg-background py-0 pl-3 pr-2 group-hover:bg-accent/50",
                    l.level === "E" && "bg-red-500/10 group-hover:bg-red-500/20",
                  )}
                >
                  {l.ts && (
                    <span className="shrink-0 text-muted-foreground">
                      {l.ts}
                    </span>
                  )}
                  {l.pid && (
                    <span className="shrink-0 text-muted-foreground">
                      {l.pid}
                    </span>
                  )}
                  {l.level && (
                    <span
                      className={cn(
                        "shrink-0 font-bold",
                        LEVEL_TEXT[l.level],
                      )}
                    >
                      {l.level}
                    </span>
                  )}
                  {l.tag && (
                    <span
                      className={cn(
                        "w-24 shrink-0 truncate",
                        l.level === "E"
                          ? "text-red-500"
                          : "text-foreground/80",
                      )}
                    >
                      {l.tag}
                    </span>
                  )}
                  {json && (
                    <button
                      type="button"
                      title="查看 JSON"
                      onClick={() => setJsonDialog(json)}
                      className="h-4 shrink-0 self-center rounded border border-border px-1 font-mono text-[9px] leading-4 text-muted-foreground hover:border-ring hover:text-foreground"
                    >
                      {"{ }"}
                    </button>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 pr-3",
                    l.level === "E" && "text-red-500",
                    l.level === "W" && "text-yellow-500",
                  )}
                >
                  {l.msg}
                </span>
              </div>
            );
          })}
          {active && visibleLines.length === 0 && !active.error && (
            <div className="px-3 py-1 text-muted-foreground">等待日志…</div>
          )}
        </div>
      </div>
      <Dialog
        open={jsonDialog !== null}
        onOpenChange={(open) => !open && setJsonDialog(null)}
      >
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="flex-row items-center justify-between px-6 pt-6">
            <DialogTitle className="flex items-center gap-2">
              JSON
              {jsonDialog && !prettyJson(jsonDialog.json).ok && (
                <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-normal text-yellow-500">
                  可能被 logcat 截断,无法解析
                </span>
              )}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              className="mr-6 h-6 px-2 text-[11px]"
              onClick={() => {
                if (!jsonDialog) return;
                void navigator.clipboard.writeText(
                  [
                    structureFreeText(jsonDialog.prefix),
                    prettyJson(jsonDialog.json).text,
                    structureFreeText(jsonDialog.suffix),
                  ]
                    .filter(Boolean)
                    .join("\n"),
                );
              }}
            >
              <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.75} />
              复制全部
            </Button>
          </DialogHeader>
          <div className="select-text max-h-[65vh] cursor-text space-y-2 overflow-auto px-6 pb-6 font-mono text-[12px] leading-relaxed">
            {jsonDialog?.prefix.trim() && (
              <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                {structureFreeText(jsonDialog.prefix)}
              </pre>
            )}
            {jsonDialog && (
              <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-foreground/[0.03] p-3">
                {prettyJson(jsonDialog.json).text}
              </pre>
            )}
            {jsonDialog?.suffix.trim() && (
              <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                {structureFreeText(jsonDialog.suffix)}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
