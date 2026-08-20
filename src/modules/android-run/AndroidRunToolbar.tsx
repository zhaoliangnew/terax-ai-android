import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Folder01Icon,
  PlayIcon,
  Refresh01Icon,
  SmartPhone01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  adbCmd,
  connectDevice,
  disconnectDevice,
  installCommand,
} from "./lib/adb";
import { useLogcatStore } from "./logcatStore";
import { useActiveProductConfig, useAndroidRunStore } from "./store";

type Props = {
  compact?: boolean;
};

const RUN_LABEL_PREFIX = "运行 · ";

function metadataPkgExpr(module: string): string {
  const metaPath = `${module}/build/outputs/apk/debug/output-metadata.json`;
  return `$(grep -o '"applicationId"[^,]*' ${metaPath} | head -1 | cut -d'"' -f4)`;
}

export function AndroidRunToolbar({ compact }: Props) {
  const devices = useAndroidRunStore((s) => s.devices);
  const devicesLoading = useAndroidRunStore((s) => s.devicesLoading);
  const refreshDevices = useAndroidRunStore((s) => s.refreshDevices);
  const selectDevice = useAndroidRunStore((s) => s.selectDevice);
  const selectModule = useAndroidRunStore((s) => s.selectModule);
  const adbPath = useAndroidRunStore((s) => s.adbPath);
  const setAdbPath = useAndroidRunStore((s) => s.setAdbPath);
  const {
    root: projectRoot,
    serial: selectedSerial,
    module: selectedModule,
    modules,
  } = useActiveProductConfig();
  // The run session is per-product (the current product's gradle output tab).
  const runSession = useLogcatStore((s) =>
    s.sessions.find(
      (x) => x.product === projectRoot && x.label.startsWith(RUN_LABEL_PREFIX),
    ),
  );
  const running =
    runSession != null && runSession.handle != null && !runSession.exited;

  const [connectInput, setConnectInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const onConnect = async () => {
    const target = connectInput.trim();
    if (!target || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await connectDevice(target);
      setConnectInput("");
      await refreshDevices();
    } catch (err) {
      setConnectError(String(err instanceof Error ? err.message : err));
    } finally {
      setConnecting(false);
    }
  };

  const onDisconnect = async (serial: string) => {
    setDisconnecting(serial);
    try {
      await disconnectDevice(serial);
      await refreshDevices();
    } finally {
      setDisconnecting(null);
    }
  };

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const selectedDevice =
    devices.find((d) => d.serial === selectedSerial) ?? null;
  const canRun =
    selectedDevice?.state === "device" &&
    selectedModule !== null &&
    projectRoot !== null;

  // 运行不占用用户终端:输出进右下面板当前产品的「运行」tab(AS 模式)。
  const onRun = () => {
    if (!canRun || !selectedModule || !selectedSerial || !projectRoot) return;
    const store = useLogcatStore.getState();
    const prev = store.sessions.find(
      (x) => x.product === projectRoot && x.label.startsWith(RUN_LABEL_PREFIX),
    );
    if (prev) store.closeSession(prev.id);
    const launch = `${adbCmd()} -s ${selectedSerial} shell monkey -p ${metadataPkgExpr(selectedModule)} -c android.intent.category.LAUNCHER 1`;
    void store.startCommandSession(
      projectRoot,
      `${RUN_LABEL_PREFIX}${selectedModule}`,
      `cd '${projectRoot}' && ${installCommand(selectedModule)} && ${launch}`,
    );
  };

  const onStop = () => {
    if (runSession) useLogcatStore.getState().stopSession(runSession.id);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void refreshDevices();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 max-w-56 gap-1.5 rounded-md px-2 text-xs"
            title={
              selectedDevice
                ? `${selectedDevice.vendor} ${selectedDevice.model} · ${selectedDevice.serial} · Android ${selectedDevice.androidVersion} · API ${selectedDevice.apiLevel}`
                : "选择设备"
            }
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                selectedDevice?.state === "device"
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/40"
              }`}
            />
            <HugeiconsIcon
              icon={SmartPhone01Icon}
              size={13}
              strokeWidth={1.75}
            />
            <span className="truncate">
              {selectedDevice
                ? `${selectedDevice.vendor ? `${selectedDevice.vendor} ` : ""}${selectedDevice.model}`
                : devicesLoading
                  ? "扫描设备…"
                  : "无设备"}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs">
            设备
            {devicesLoading && (
              <span className="text-[10px] text-muted-foreground">刷新中…</span>
            )}
          </DropdownMenuLabel>
          {devices.length === 0 && (
            <DropdownMenuItem disabled className="text-xs">
              没有在线设备
            </DropdownMenuItem>
          )}
          {devices.map((d) => {
            const isNetworkDevice = d.serial.includes(":");
            return (
              <DropdownMenuItem
                key={d.serial}
                disabled={d.state !== "device"}
                onSelect={() => selectDevice(d.serial)}
                className="gap-2 text-xs"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    d.state === "device"
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40"
                  }`}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="whitespace-nowrap font-medium">
                    {d.vendor ? `${d.vendor} · ` : ""}
                    {d.model}
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {d.state === "device"
                      ? `${d.serial} · Android ${d.androidVersion} · API ${d.apiLevel}`
                      : `${d.serial} · ${d.state}`}
                  </span>
                </span>
                {isNetworkDevice && (
                  <button
                    type="button"
                    title="断开连接"
                    disabled={disconnecting === d.serial}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      void onDisconnect(d.serial);
                    }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={12}
                      strokeWidth={2}
                    />
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void refreshDevices()}
            className="gap-2 text-xs"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
            刷新设备
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <div className="mb-1 text-[10px] text-muted-foreground">
              连接新设备(IP 或 IP:端口,默认 5555)
            </div>
            <div className="flex items-center gap-1">
              <input
                value={connectInput}
                onChange={(e) => setConnectInput(e.target.value)}
                placeholder="192.168.1.100"
                spellCheck={false}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") void onConnect();
                }}
                className="h-6 min-w-0 flex-1 rounded border border-input bg-transparent px-1.5 font-mono text-[10px] outline-none focus:border-ring"
              />
              <Button
                size="sm"
                disabled={!connectInput.trim() || connecting}
                onClick={() => void onConnect()}
                className="h-6 shrink-0 px-2 text-[10px]"
              >
                {connecting ? "连接中…" : "连接"}
              </Button>
            </div>
            {connectError && (
              <div className="mt-1 text-[10px] text-red-500">
                {connectError}
              </div>
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <div className="mb-1 text-[10px] text-muted-foreground">
              adb 路径(留空=自动查找)
            </div>
            <input
              defaultValue={adbPath}
              placeholder="/Users/…/platform-tools/adb"
              spellCheck={false}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  setAdbPath((e.target as HTMLInputElement).value);
                }
              }}
              onBlur={(e) => setAdbPath(e.target.value)}
              className="h-6 w-full rounded border border-input bg-transparent px-1.5 font-mono text-[10px] outline-none focus:border-ring"
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 max-w-44 gap-1.5 rounded-md px-2 text-xs"
            title={projectRoot ? `模块 · ${projectRoot}` : "模块"}
          >
            <HugeiconsIcon icon={Folder01Icon} size={13} strokeWidth={1.75} />
            <span className="truncate">{selectedModule ?? "模块"}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel className="text-xs">模块</DropdownMenuLabel>
          {modules.map((m) => (
            <DropdownMenuItem
              key={m}
              onSelect={() => selectModule(m)}
              className="text-xs"
            >
              {m}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            从 settings.gradle 自动发现
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        size="sm"
        disabled={!canRun}
        onClick={onRun}
        title="编译安装并启动 (installDebug + launch)"
        className="h-7 gap-1 rounded-md bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-500"
      >
        <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
        {!compact && "运行"}
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!running}
        onClick={onStop}
        title="停止构建/运行"
        className={`size-7 shrink-0 rounded-md ${running ? "text-red-500" : "text-muted-foreground"}`}
      >
        <HugeiconsIcon icon={StopIcon} size={14} strokeWidth={1.75} />
      </Button>
    </div>
  );
}
