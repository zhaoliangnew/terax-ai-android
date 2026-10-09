import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AndroidRunToolbar } from "./AndroidRunToolbar";
import { DeviceManagerPanel } from "./DeviceManagerPanel";
import { DeviceMirror } from "./DeviceMirror";
import LogcatPanel from "./LogcatDock";
import { highlightSerial } from "./lib/highlightSerial";
import { useMirrorAnnotate } from "./lib/mirrorAnnotate";
import {
  type MirrorQuality,
  resolveMirrorQuality,
  useMirrorQuality,
} from "./lib/mirrorQuality";
import {
  useActiveProductConfig,
  useAndroidRunStore,
  useMirroringSerials,
} from "./store";

const QUALITY_OPTIONS: [MirrorQuality, string][] = [
  ["auto", "自动"],
  ["smooth", "流畅"],
  ["hd", "高清"],
];

/** 右栏"投屏"tab:上半屏幕镜像(含设备/运行工具栏),下半 Logcat。 */
export default function DevicePanel() {
  const devices = useAndroidRunStore((s) => s.devices);
  const setMirroring = useAndroidRunStore((s) => s.setMirroring);
  const setDeviceManagerOpen = useAndroidRunStore(
    (s) => s.setDeviceManagerOpen,
  );
  const { serial: selectedSerial, mirroring } = useActiveProductConfig();
  const annotatingSerial = useMirrorAnnotate((s) => s.serial);
  const quality = useMirrorQuality((s) => s.quality);
  const setQuality = useMirrorQuality((s) => s.setQuality);
  const toggleAnnotate = useMirrorAnnotate((s) => s.toggle);
  const device = devices.find((d) => d.serial === selectedSerial) ?? null;
  const online = device?.state === "device";
  const anyOnline = devices.some((d) => d.state === "device");

  // Every device any product wants mirrored — kept alive across tab switches.
  const mirroringSerials = useMirroringSerials();

  return (
    <ResizablePanelGroup orientation="vertical" className="h-full min-h-0">
      <ResizablePanel id="mirror" defaultSize="65%" minSize="20%">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5">
            {device && (
              <span className="truncate text-[13px] text-muted-foreground">
                {device.vendor ? `${device.vendor} ` : ""}
                {device.model} · {highlightSerial(device.serial)}
              </span>
            )}
            {online && mirroring && selectedSerial && (
              <button
                type="button"
                onClick={() => toggleAnnotate(selectedSerial)}
                title="在投屏画面上标注问题,发给聊天里的 AI"
                className={cn(
                  "rounded px-2 py-0.5 text-[12px] transition-colors",
                  annotatingSerial === selectedSerial
                    ? "bg-[#2c67c5] text-white"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                批注
              </button>
            )}
            {online && mirroring && selectedSerial && (
              // 画质:自动按地址判断(10.x 虚拟 IP 走公网 → 流畅),也能手动固定
              <div
                className="flex items-center rounded border border-border text-[12px]"
                title={`流畅:2 Mbps · 20 帧 · 1280,跨公网用\n高清:8 Mbps · 60 帧 · 1600,内网用\n自动:10.x 虚拟 IP 用流畅,其余用高清\n当前实际:${resolveMirrorQuality(quality, selectedSerial) === "smooth" ? "流畅" : "高清"}`}
              >
                {QUALITY_OPTIONS.map(([q, text]) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={cn(
                      "px-1.5 py-0.5 transition-colors first:rounded-l last:rounded-r",
                      quality === q
                        ? "bg-foreground/15 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {q === "auto"
                      ? `自动·${resolveMirrorQuality("auto", selectedSerial) === "smooth" ? "流畅" : "高清"}`
                      : text}
                  </button>
                ))}
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              {online &&
                (mirroring ? (
                  <button
                    type="button"
                    onClick={() => setMirroring(false)}
                    className="rounded border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground"
                  >
                    停止投屏
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMirroring(true)}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[12px] text-white hover:bg-emerald-500"
                  >
                    投屏
                  </button>
                ))}
              {online && selectedSerial && (
                <button
                  type="button"
                  onClick={() =>
                    void native.shellBgSpawn(
                      `scrcpy -s ${selectedSerial}`,
                      null,
                    )
                  }
                  title="用官方 scrcpy 独立窗口打开(保底方案)"
                  className="rounded border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  外部窗口
                </button>
              )}
              <AndroidRunToolbar compact />
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {/* Keep every mirroring device mounted; only show the active one. */}
            {mirroringSerials.map((s) => (
              <DeviceMirror
                key={s}
                serial={s}
                visible={mirroring && s === selectedSerial}
              />
            ))}
            {!(mirroring && selectedSerial) && (
              // 整块空白就是动作按钮 —— 比让人去右上角找那颗小按钮顺手得多。
              // 选中了在线设备:点击开始投屏;有在线设备但没选中(比如刚断开
              // 了上一台):点击打开设备列表去选,别谎报"没有在线设备"。
              <button
                type="button"
                disabled={!online && !anyOnline}
                onClick={() => {
                  if (online) setMirroring(true);
                  else if (anyOnline) setDeviceManagerOpen(true);
                }}
                className="absolute inset-0 flex items-center justify-center enabled:cursor-pointer enabled:hover:bg-accent/20"
              >
                <span className="flex flex-col items-center gap-2 text-muted-foreground">
                  <HugeiconsIcon
                    icon={SmartPhone01Icon}
                    size={36}
                    strokeWidth={1}
                  />
                  <span className="text-[12px]">
                    {online
                      ? "点击开始投屏"
                      : anyOnline
                        ? "未选择设备 · 点击选择"
                        : "没有在线设备"}
                  </span>
                </span>
              </button>
            )}
            <DeviceManagerPanel />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle
        withHandle
        className="h-2.5 cursor-row-resize bg-border/50 transition-colors hover:bg-border"
      />
      <ResizablePanel id="logcat" defaultSize="35%" minSize="15%">
        <LogcatPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
