import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { native } from "@/modules/ai/lib/native";
import { SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AndroidRunToolbar } from "./AndroidRunToolbar";
import { DeviceManagerPanel } from "./DeviceManagerPanel";
import { DeviceMirror } from "./DeviceMirror";
import LogcatPanel from "./LogcatDock";
import { highlightSerial } from "./lib/highlightSerial";
import {
  useActiveProductConfig,
  useAndroidRunStore,
  useMirroringSerials,
} from "./store";

/** 右侧设备列:上半屏幕镜像(含设备/运行工具栏),下半 Logcat,固定常驻。 */
export default function DevicePanel() {
  const devices = useAndroidRunStore((s) => s.devices);
  const setMirroring = useAndroidRunStore((s) => s.setMirroring);
  const setDeviceManagerOpen = useAndroidRunStore(
    (s) => s.setDeviceManagerOpen,
  );
  const { serial: selectedSerial, mirroring } = useActiveProductConfig();
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
            <HugeiconsIcon
              icon={SmartPhone01Icon}
              size={13}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span className="text-[13px] font-semibold">屏幕镜像</span>
            {device && (
              <span className="truncate text-[14px] text-muted-foreground">
                {device.vendor ? `${device.vendor} ` : ""}
                {device.model} · {highlightSerial(device.serial)}
              </span>
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
