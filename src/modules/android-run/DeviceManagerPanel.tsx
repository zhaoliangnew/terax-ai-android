import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  Cancel01Icon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { connectDevice, disconnectDevice } from "./lib/adb";
import { ipSuffix } from "./lib/highlightSerial";
import { useActiveProductConfig, useAndroidRunStore } from "./store";

/** The single "all devices" surface, rendered inline over the mirror area
 * (not a floating modal) — every device ever seen (online or not, keyed by
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
  const shown = hideOffline ? list.filter((d) => isSnOnline(d.sn)) : list;

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

  if (!open) return null;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: click-outside-to-dismiss backdrop, not real page content */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same — a decorative click-catcher */}
      <div
        className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="absolute inset-y-3 right-3 left-[32%] z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-white/10">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            历史设备
            {devicesLoading && (
              <span className="text-[11px] font-normal text-muted-foreground">
                刷新中…
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
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
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-2.5">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation wrapper only, real controls are inside */}
            {/* biome-ignore lint/a11y/useSemanticElements: contains its own inputs/button, can't be a <button> */}
            <div
              onKeyDown={(e) => e.stopPropagation()}
              className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-border px-3.5 py-2"
            >
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
                连接新设备
              </span>
              <input
                value={connectInput}
                onChange={(e) => setConnectInput(e.target.value)}
                placeholder="192.168.1.100"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onConnectNew();
                }}
                className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[13px] outline-none focus:border-ring"
              />
              <Button
                size="sm"
                disabled={!connectInput.trim() || connecting}
                onClick={() => void onConnectNew()}
                className="h-7 shrink-0 px-2.5 text-xs"
              >
                {connecting ? "连接中…" : "连接"}
              </Button>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">
                IP 或 IP:端口,默认端口 5555
              </span>
              {connectError && (
                <span className="basis-full whitespace-pre-wrap break-all text-[10px] leading-4 text-red-500">
                  {connectError}
                </span>
              )}
            </div>
            {shown.length === 0 && (
              <div className="col-span-2 px-3 py-6 text-center text-sm text-muted-foreground">
                {list.length === 0
                  ? "还没有连接过的设备"
                  : "没有在线设备(右上角开关关掉可看离线记录)"}
              </div>
            )}
            {shown.map((d) => {
              const live = liveDevices.find(
                (x) => x.sn === d.sn && x.state === "device",
              );
              const isOnline = !!live;
              const isSelected = isOnline && live?.serial === selectedSerial;
              const canReconnect = d.serial.includes(":");
              return (
                <div
                  key={d.sn}
                  className={cn(
                    "group relative flex min-w-0 flex-col gap-1.5 rounded-xl border p-3.5 hover:bg-accent/30",
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
                      if (isOnline || canReconnect) void onPick(d.sn, d.serial);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (isOnline || canReconnect)
                          void onPick(d.sn, d.serial);
                      }
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left",
                      isOnline || canReconnect
                        ? "cursor-pointer"
                        : "cursor-default",
                      !isOnline && "opacity-50",
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5 pr-10">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          isOnline
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="truncate text-[15px] font-semibold">
                        {d.vendor ? `${d.vendor} · ` : ""}
                        {d.model}
                      </span>
                    </span>
                    <span className="flex w-full min-w-0 items-center gap-2 text-[12px] text-muted-foreground/70">
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
                        className="min-w-0 shrink-0 truncate text-left hover:text-foreground hover:underline"
                      >
                        SN:{d.sn}
                      </button>
                      {/* /sdcard/key.txt 的激活 key:在线时刷新,离线显示最后读到的 */}
                      {d.key && (
                        <button
                          type="button"
                          title={`点击复制 key · ${d.key}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyToClipboard(d.key ?? "");
                            toast.success("已复制 key", { description: d.key });
                          }}
                          className="min-w-0 truncate text-left hover:text-foreground hover:underline"
                        >
                          key:{d.key}
                        </button>
                      )}
                    </span>
                    <span className="w-full min-w-0 truncate text-[13px] text-muted-foreground">
                      {d.serial} · Android {d.androidVersion} · API {d.apiLevel}
                      {connectingSn === d.sn && " · 连接中…"}
                    </span>
                    {failedSn === d.sn && (
                      <span className="text-[11px] text-yellow-500">
                        连不上这个 IP,设备地址可能变了 ——
                        用下面"连接新设备"手动连一次
                      </span>
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
                        placeholder="备注"
                        className="mt-0.5 h-6 w-32 rounded border border-input bg-transparent px-1.5 text-[12px] outline-none focus:border-ring"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNoteInput(deviceNotes[d.sn] ?? "");
                          setEditingNote(d.sn);
                        }}
                        className="mt-0.5 min-w-0 max-w-full"
                      >
                        {deviceNotes[d.sn] ? (
                          <span
                            className={cn(
                              "block truncate rounded px-2 py-0.5 text-[12px] font-medium",
                              // 离线卡片整体已经叠了 opacity-50,这里再用半透明
                              // 绿字就成 25% 了,根本看不清 —— 离线改灰底 + 正常
                              // 字色,叠完和旁边 serial 行一个可读度。
                              isOnline
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-muted-foreground/20 text-foreground",
                            )}
                          >
                            {deviceNotes[d.sn]}
                            {ipSuffix(d.serial) && ` · ${ipSuffix(d.serial)}`}
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground/50 hover:text-muted-foreground">
                            + 备注
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="shrink-0 border-t border-border px-4 py-3">
          <div className="mb-1 text-[11px] text-muted-foreground">
            adb 路径(留空=自动查找)
          </div>
          <input
            defaultValue={adbPath}
            placeholder="/Users/…/platform-tools/adb"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAdbPath((e.target as HTMLInputElement).value);
              }
            }}
            onBlur={(e) => setAdbPath(e.target.value)}
            className="h-7 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
          />
        </div>
      </div>
    </>
  );
}
