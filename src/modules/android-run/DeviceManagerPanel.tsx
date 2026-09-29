import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  Cancel01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { connectDevice, disconnectDevice } from "./lib/adb";
import { ipSuffix } from "./lib/highlightSerial";
import { useActiveProductConfig, useAndroidRunStore } from "./store";

const KEYWORDS_KEY = "terax.android.deviceKeywords";

/** 筛选关键词:自己加过就用自己的;没加过拿备注里常见的开头垫着。 */
function loadKeywords(notes: string[]): string[] {
  try {
    const raw = localStorage.getItem(KEYWORDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return noteTags(notes);
}

/** 备注的类别:第一个"-"或空格前那段("出入库-王丽" → 出入库)。 */
function noteTag(note: string): string | null {
  const head = note
    .trim()
    .split(/[-\s·_]/)[0]
    ?.trim();
  return head || null;
}

/** 出现两次以上的备注类别,做成筛选标签;按出现次数排。 */
function noteTags(notes: string[]): string[] {
  const count = new Map<string, number>();
  for (const n of notes) {
    const t = noteTag(n);
    if (t) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

/** 设备所在网段(192.168.8.x);USB 连的没有 IP,单独一组。 */
function subnetOf(serial: string): string {
  const m = /^(\d+\.\d+\.\d+)\.\d+(?::\d+)?$/.exec(serial);
  return m ? `${m[1]}.x` : "USB";
}

/**
 * 标题前已经有 IP 后两位了,地址行只补它说不清的部分:不是 192.168 网段就给
 * 完整 IP,端口不是 5555 就带上端口;USB 连的(没有 IP)给序列号。
 */
function extraAddress(serial: string): string | null {
  const m = /^(\d+\.\d+)\.(\d+\.\d+)(?::(\d+))?$/.exec(serial);
  if (!m) return serial;
  const [, prefix, tail, port] = m;
  const host = prefix === "192.168" ? null : `${prefix}.${tail}`;
  const extraPort = port && port !== "5555" ? `:${port}` : "";
  if (!host && !extraPort) return null;
  return `${host ?? tail}${extraPort}`;
}

/** The single "all devices" surface, a window-level overlay (portaled to
 * body so it covers the whole window, not just the narrow right panel) —
 * every device ever seen (online or not, keyed by
 * SN so it survives an IP change), connect-by-IP, adb path, and per-device
 * notes, all in one place. Click a card to select it (reconnecting first if
 * it's a network device that's currently offline) and start mirroring; ✕
 * forgets the history entry, the small disconnect icon drops a live
 * connection. */
export function DeviceManagerPanel() {
  const open = useAndroidRunStore((s) => s.deviceManagerOpen);
  const setOpen = useAndroidRunStore((s) => s.setDeviceManagerOpen);
  const knownDevices = useAndroidRunStore((s) => s.knownDevices);
  const deviceNotes = useAndroidRunStore((s) => s.deviceNotes);
  const setDeviceNote = useAndroidRunStore((s) => s.setDeviceNote);
  const forgetDevice = useAndroidRunStore((s) => s.forgetDevice);
  const liveDevices = useAndroidRunStore((s) => s.devices);
  const devicesLoading = useAndroidRunStore((s) => s.devicesLoading);
  const selectDevice = useAndroidRunStore((s) => s.selectDevice);
  const setMirroring = useAndroidRunStore((s) => s.setMirroring);
  const refreshDevices = useAndroidRunStore((s) => s.refreshDevices);
  const adbPath = useAndroidRunStore((s) => s.adbPath);
  const setAdbPath = useAndroidRunStore((s) => s.setAdbPath);
  const { serial: selectedSerial } = useActiveProductConfig();

  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [connectingSn, setConnectingSn] = useState<string | null>(null);
  const [failedSn, setFailedSn] = useState<string | null>(null);
  const [disconnectingSerial, setDisconnectingSerial] = useState<string | null>(
    null,
  );
  const [connectInput, setConnectInput] = useState("192.168.");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (open) void refreshDevices();
  }, [open, refreshDevices]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // 隐藏离线设备的开关,记住上次的选择
  const [hideOffline, setHideOffline] = useState(
    () => localStorage.getItem("terax.android.hideOfflineDevices") === "1",
  );
  useEffect(() => {
    localStorage.setItem(
      "terax.android.hideOfflineDevices",
      hideOffline ? "1" : "0",
    );
  }, [hideOffline]);

  const isSnOnline = (sn: string) =>
    liveDevices.some((x) => x.sn === sn && x.state === "device");

  // 只按 IP 数值排(.9 排在 .71 前面),不做"在线优先"分组 —— 分组会让
  // 卡片随着设备上下线来回挪,固定的 IP 顺序才是肌肉记忆能记住的。
  const list = Object.values(knownDevices).sort((a, b) => {
    const ipA = /^(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(a.serial);
    const ipB = /^(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(b.serial);
    if (ipA && ipB) {
      for (let i = 1; i <= 4; i++) {
        const diff = Number(ipA[i]) - Number(ipB[i]);
        if (diff !== 0) return diff;
      }
      return 0;
    }
    if (ipA) return -1;
    if (ipB) return 1;
    return a.serial.localeCompare(b.serial);
  });
  // 筛选:搜索框(备注/型号/IP/SN 任意一段)或点关键词标签(出入库、餐台…)。
  // 关键词自己加减;没加过时先用备注里常见的开头(出现两次以上的)垫着
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>(() =>
    loadKeywords(Object.values(useAndroidRunStore.getState().deviceNotes)),
  );
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const saveKeywords = (next: string[]) => {
    setKeywords(next);
    try {
      localStorage.setItem(KEYWORDS_KEY, JSON.stringify(next));
    } catch {}
  };
  const matches = (d: (typeof list)[number], word: string) =>
    [deviceNotes[d.sn] ?? "", d.vendor ?? "", d.model]
      .join(" ")
      .toLowerCase()
      .includes(word.toLowerCase());
  const q = query.trim().toLowerCase();
  const shown = list.filter((d) => {
    if (hideOffline && !isSnOnline(d.sn)) return false;
    const note = deviceNotes[d.sn] ?? "";
    if (tag && !matches(d, tag)) return false;
    if (!q) return true;
    return [note, d.vendor ?? "", d.model, d.serial, d.sn, d.key ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const onPick = async (sn: string, serial: string) => {
    const live = liveDevices.find((d) => d.sn === sn && d.state === "device");
    if (live) {
      selectDevice(live.serial);
      setMirroring(true);
      setOpen(false);
      return;
    }
    if (!serial.includes(":")) return; // USB device with no address to redial
    setConnectingSn(sn);
    setFailedSn(null);
    try {
      await connectDevice(serial);
      await refreshDevices();
      const reconnected = useAndroidRunStore
        .getState()
        .devices.find((d) => d.sn === sn && d.state === "device");
      if (reconnected) {
        selectDevice(reconnected.serial);
        setMirroring(true);
        setOpen(false);
      } else {
        setFailedSn(sn); // connected but adb still doesn't see it as online
      }
    } catch {
      // stored IP is stale — the device's address most likely changed
      setFailedSn(sn);
    } finally {
      setConnectingSn(null);
    }
  };

  const onConnectNew = async () => {
    const target = connectInput.trim();
    if (!target || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await connectDevice(target);
      setConnectInput("192.168.");
      await refreshDevices();
      const normalized = target.includes(":") ? target : `${target}:5555`;
      const connected = useAndroidRunStore
        .getState()
        .devices.find((d) => d.serial === normalized && d.state === "device");
      if (connected) {
        selectDevice(connected.serial);
        setMirroring(true);
        setOpen(false);
      }
    } catch (err) {
      setConnectError(String(err instanceof Error ? err.message : err));
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnect = async (serial: string) => {
    setDisconnectingSerial(serial);
    try {
      await disconnectDevice(serial);
      await refreshDevices();
    } finally {
      setDisconnectingSerial(null);
    }
  };

  // 窗口高度只长不缩:筛选/只看在线时卡片变少,窗口不跟着变矮(不跳);
  // 关掉再打开才重新按内容量
  const dialogRef = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setMinH(0);
      return;
    }
    const h = dialogRef.current?.offsetHeight ?? 0;
    if (h > minH) setMinH(h);
  });

  if (!open) return null;

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: click-outside-to-dismiss backdrop, not real page content */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same — a decorative click-catcher */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      {/* 窗口正中的大弹框:比右栏里那块宽得多(卡片能排三列左右),又不至于
          铺满整个窗口。卡片按宽度自动排列 */}
      <div
        ref={dialogRef}
        style={{ minHeight: minH || undefined }}
        className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(680px,80vh)] w-[min(1000px,86vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          {/* 标题后面直接连新设备:输 IP 回车就连 */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation wrapper only, real controls are inside */}
          <div
            onKeyDown={(e) => e.stopPropagation()}
            className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1"
          >
            <span className="mr-2 text-[13px] font-semibold">设备列表</span>
            <input
              value={connectInput}
              onChange={(e) => setConnectInput(e.target.value)}
              placeholder="连接新设备:IP 或 IP:端口"
              title="默认端口 5555"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onConnectNew();
              }}
              className="h-7 w-52 min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-[12.5px] outline-none focus:border-ring"
            />
            <Button
              size="sm"
              disabled={!connectInput.trim() || connecting}
              onClick={() => void onConnectNew()}
              className="h-7 shrink-0 px-2.5 text-xs"
            >
              {connecting ? "连接中…" : "连接"}
            </Button>
            {devicesLoading && (
              <span className="text-[11px] text-muted-foreground">刷新中…</span>
            )}
            {connectError && (
              <span className="basis-full whitespace-pre-wrap break-all text-[11px] leading-4 text-red-500">
                {connectError}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[12px]"
              onClick={() => void refreshDevices()}
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={13}
                strokeWidth={1.75}
              />
              刷新
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => setOpen(false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-3">
          {[null, ...keywords].map((t) => (
            <span key={t ?? "__all"}>
              <button
                type="button"
                onClick={() => setTag(t)}
                className={cn(
                  "h-6 cursor-pointer rounded-full border px-2.5 text-[12px] transition-colors",
                  tag === t
                    ? "border-foreground/30 bg-foreground/15 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {t ?? "全部"}
                <span className="ml-1 text-muted-foreground/70">
                  {t === null
                    ? list.length
                    : list.filter((d) => matches(d, t)).length}
                </span>
                {/* 删除只在选中的那个上出现,放在标签里面:悬停扫过不会误点 */}
                {t !== null && tag === t && (
                  // biome-ignore lint/a11y/useSemanticElements: nested in the chip button, can't be a <button>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`删掉关键词 ${t}`}
                    title="删掉这个关键词"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveKeywords(keywords.filter((k) => k !== t));
                      setTag(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        saveKeywords(keywords.filter((k) => k !== t));
                        setTag(null);
                      }
                    }}
                    className="-mr-1 ml-1.5 inline-flex size-4 items-center justify-center rounded-full text-[11px] text-muted-foreground hover:bg-foreground/15 hover:text-foreground"
                  >
                    ×
                  </span>
                )}
              </button>
            </span>
          ))}
          {addingKeyword ? (
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
            <input
              autoFocus
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  const k = keywordInput.trim();
                  if (k && !keywords.includes(k))
                    saveKeywords([...keywords, k]);
                  setKeywordInput("");
                  setAddingKeyword(false);
                } else if (e.key === "Escape") {
                  setAddingKeyword(false);
                }
              }}
              onBlur={() => setAddingKeyword(false)}
              placeholder="关键词,回车添加"
              className="h-6 w-32 rounded-full border border-input bg-transparent px-2.5 text-[12px] outline-none focus:border-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingKeyword(true)}
              className="h-6 cursor-pointer rounded-full border border-dashed border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              + 关键词
            </button>
          )}
          {/* 搜索、只看在线和关键词都是筛选,放一行 */}
          <span className="ml-auto flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="搜备注 / 型号 / IP / SN"
              spellCheck={false}
              className="h-7 w-52 rounded-md border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
            />
            <Button
              variant="outline"
              size="sm"
              title={hideOffline ? "当前只显示在线设备" : "隐藏离线设备"}
              onClick={() => setHideOffline((v) => !v)}
              className={cn(
                "h-7 gap-1.5 px-2 text-[12px]",
                hideOffline && "border-emerald-500/50 text-emerald-500",
              )}
            >
              只看在线
            </Button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2.5">
            {shown.length === 0 && (
              <div className="col-span-full px-3 py-6 text-center text-sm text-muted-foreground">
                {list.length === 0
                  ? "还没有连接过的设备"
                  : q || tag
                    ? "没有符合筛选的设备"
                    : "没有在线设备(右上角开关关掉可看离线记录)"}
              </div>
            )}
            {shown.map((d, i) => {
              const live = liveDevices.find(
                (x) => x.sn === d.sn && x.state === "device",
              );
              const isOnline = !!live;
              const isSelected = isOnline && live?.serial === selectedSerial;
              const canReconnect = d.serial.includes(":");
              // 按网段分组(192.168.8.x / 192.168.9.x …):列表按 IP 排好了,
              // 网段一变就插一条组标题
              const net = subnetOf(d.serial);
              const newGroup = i === 0 || subnetOf(shown[i - 1].serial) !== net;
              return (
                <Fragment key={d.sn}>
                  {newGroup && (
                    <div className="col-span-full flex items-center gap-2 pt-1.5 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">
                        {net}
                      </span>
                      <span>
                        {shown.filter((x) => subnetOf(x.serial) === net).length}{" "}
                        台
                      </span>
                      <span className="h-px flex-1 bg-border/70" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "group relative flex min-w-0 flex-col gap-1.5 rounded-xl border p-3.5 pb-7 hover:bg-accent/30",
                      isSelected
                        ? "border-emerald-500 ring-1 ring-emerald-500/50 hover:border-emerald-500"
                        : "border-border hover:border-ring/60",
                    )}
                  >
                    <div className="absolute top-2 right-2">
                      <span
                        className={cn(
                          "rounded px-1 py-0.5 text-[10px] font-medium leading-none",
                          isOnline
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-muted-foreground/15 text-muted-foreground",
                        )}
                      >
                        {isOnline ? "在线" : "离线"}
                      </span>
                    </div>
                    <div className="absolute bottom-2 right-2.5 flex items-center gap-2.5 rounded bg-background/85 px-1.5 py-0.5 opacity-0 backdrop-blur-[2px] group-hover:opacity-100">
                      {isOnline && live && (
                        <button
                          type="button"
                          disabled={disconnectingSerial === live.serial}
                          onClick={() => void onDisconnect(live.serial)}
                          className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          断开连接
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => forgetDevice(d.sn)}
                        className="text-[11px] text-muted-foreground hover:text-red-400"
                      >
                        删除
                      </button>
                    </div>
                    {/* biome-ignore lint/a11y/useSemanticElements: contains its own interactive note editor, can't be a <button> */}
                    <div
                      role="button"
                      tabIndex={isOnline || canReconnect ? 0 : -1}
                      onClick={() => {
                        if (isOnline || canReconnect)
                          void onPick(d.sn, d.serial);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isOnline || canReconnect)
                            void onPick(d.sn, d.serial);
                        }
                      }}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col items-start gap-1 text-left",
                        isOnline || canReconnect
                          ? "cursor-pointer"
                          : "cursor-default",
                      )}
                    >
                      {/* 标题是备注(自己起的名字最好认),没备注才用型号;
                        点标题旁的铅笔改备注 */}
                      <span className="flex w-full min-w-0 items-center gap-2 pr-10">
                        {/* IP 后两位:同一网段几十台设备,靠它和备注认设备;
                          底色兼当在线状态(绿=在线) */}
                        {ipSuffix(d.serial) ? (
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[13px] font-bold leading-none",
                              isOnline
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-sky-500/15 text-sky-400",
                            )}
                          >
                            {ipSuffix(d.serial)}
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              isOnline
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/40",
                            )}
                          />
                        )}
                        {editingNote === d.sn ? (
                          // biome-ignore lint/a11y/noAutofocus: opened by an explicit click to edit
                          <input
                            autoFocus
                            value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                setDeviceNote(d.sn, noteInput);
                                setEditingNote(null);
                              } else if (e.key === "Escape") {
                                setEditingNote(null);
                              }
                            }}
                            onBlur={() => {
                              setDeviceNote(d.sn, noteInput);
                              setEditingNote(null);
                            }}
                            placeholder="给这台设备起个名字"
                            className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 text-[14px] font-medium outline-none focus:border-ring"
                          />
                        ) : (
                          <>
                            <span
                              className={cn(
                                "min-w-0 truncate text-[15px] font-semibold",
                                isOnline
                                  ? "text-foreground"
                                  : "text-foreground/75",
                              )}
                            >
                              {deviceNotes[d.sn] ||
                                `${d.vendor ? `${d.vendor} · ` : ""}${d.model}`}
                            </span>
                            <button
                              type="button"
                              title={deviceNotes[d.sn] ? "改备注" : "加备注"}
                              onClick={(e) => {
                                e.stopPropagation();
                                setNoteInput(deviceNotes[d.sn] ?? "");
                                setEditingNote(d.sn);
                              }}
                              className={cn(
                                "shrink-0 rounded px-1 text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                                deviceNotes[d.sn] &&
                                  "opacity-0 group-hover:opacity-100",
                              )}
                            >
                              {deviceNotes[d.sn] ? "✎" : "+ 备注"}
                            </button>
                          </>
                        )}
                      </span>
                      {/* 第二行:型号(有备注时;没备注它就是标题)· 系统版本。IP 后两位
                        已经在标题前面了,常见的 192.168.x.x:5555 不再重复,
                        别的网段/端口才补上 */}
                      <span className="w-full min-w-0 truncate text-[13px] text-muted-foreground">
                        {extraAddress(d.serial) && (
                          <span className="text-foreground/85">
                            {extraAddress(d.serial)} ·{" "}
                          </span>
                        )}
                        {deviceNotes[d.sn] &&
                          `${d.vendor ? `${d.vendor} · ` : ""}${d.model} · `}
                        Android {d.androidVersion}
                        {connectingSn === d.sn && " · 连接中…"}
                      </span>
                      <span className="flex w-full min-w-0 items-center gap-3 text-[12px] text-muted-foreground/80">
                        <button
                          type="button"
                          title={`点击复制 · ${d.sn}`}
                          onClick={(e) => {
                            // 卡片本身点一下就选中/连接设备,SN 这行要单独接住点击、
                            // 别让事件冒上去触发那个。
                            e.stopPropagation();
                            void copyToClipboard(d.sn);
                            toast.success("已复制 SN", { description: d.sn });
                          }}
                          className="min-w-0 shrink truncate text-left hover:text-foreground hover:underline"
                        >
                          SN {d.sn}
                        </button>
                        {/* /sdcard/key.txt 的激活 key:在线时刷新,离线显示最后读到的 */}
                        {d.key && (
                          <button
                            type="button"
                            title={`点击复制 key · ${d.key}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void copyToClipboard(d.key ?? "");
                              toast.success("已复制 key", {
                                description: d.key,
                              });
                            }}
                            className="shrink-0 text-left hover:text-foreground hover:underline"
                          >
                            key {d.key}
                          </button>
                        )}
                      </span>
                      {failedSn === d.sn && (
                        <span className="text-[12px] text-yellow-500">
                          连不上这个 IP,设备地址可能变了 ——
                          用上面"连接新设备"手动连一次
                        </span>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
        {/* 窗口按内容高度来,不留一大块空白;adb 路径很少改,收成底下一行 */}
        <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-4 py-2">
          <span className="shrink-0 text-[11.5px] text-muted-foreground">
            adb 路径
          </span>
          <input
            defaultValue={adbPath}
            placeholder="留空自动查找"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAdbPath((e.target as HTMLInputElement).value);
              }
            }}
            onBlur={(e) => setAdbPath(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 font-mono text-[12px] text-muted-foreground outline-none hover:border-input focus:border-ring focus:text-foreground"
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
