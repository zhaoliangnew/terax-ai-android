import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useEmulatorStore } from "./emulatorStore";
import {
  type DeviceFacts,
  emulatorApi,
  isEmulatorSerial,
  isValidAvdName,
  suggestAvdName,
} from "./lib/emulator";
import { useAndroidRunStore } from "./store";

const INPUT =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring";

/** 照一台在线真机新建模拟器:选设备 → 看读到的信息、起名 → 跑流程看进度。
 * 关掉对话框流程照跑,设备列表上能点回来看进度。 */
export function CreateEmulatorDialog({ onClose }: { onClose: () => void }) {
  const job = useEmulatorStore((s) => s.job);
  const createFromDevice = useEmulatorStore((s) => s.createFromDevice);
  const dismissJob = useEmulatorStore((s) => s.dismissJob);
  const avds = useEmulatorStore((s) => s.overview?.avds ?? []);
  const devices = useAndroidRunStore((s) => s.devices);
  const notes = useAndroidRunStore((s) => s.deviceNotes);
  const realDevices = devices.filter(
    (d) => d.state === "device" && !isEmulatorSerial(d.serial),
  );

  const [source, setSource] = useState<string | null>(null);
  const [facts, setFacts] = useState<DeviceFacts | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");

  const pick = async (serial: string) => {
    setSource(serial);
    setFacts(null);
    setProbeError(null);
    setProbing(true);
    try {
      const f = await emulatorApi.probe(serial);
      setFacts(f);
      setName(suggestAvdName(f.identity.model, f.api));
      setLabel(notes[f.sn] || f.identity.model);
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const nameTaken = avds.some((a) => a.name === name);
  const nameError = !name
    ? null
    : !isValidAvdName(name)
      ? "只能用英文字母、数字和 . _ -"
      : nameTaken
        ? "已经有同名模拟器了"
        : null;
  const showJob = !!job;

  const close = () => {
    if (job && job.status !== "running") dismissJob();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="z-[60] max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>照真机新建模拟器</DialogTitle>
          <DialogDescription>
            系统版本、分辨率、型号和串口都照真机来,app 会以为自己跑在那台设备上
          </DialogDescription>
        </DialogHeader>

        {showJob ? (
          <JobProgress />
        ) : (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted-foreground">
                选一台在线真机
              </span>
              {realDevices.length === 0 && (
                <span className="text-[12px] text-yellow-500">
                  没有在线真机,先在设备列表连一台
                </span>
              )}
              <div className="flex flex-wrap gap-1.5">
                {realDevices.map((d) => (
                  <button
                    key={d.serial}
                    type="button"
                    onClick={() => void pick(d.serial)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-left text-[12px]",
                      source === d.serial
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-border hover:border-ring/60",
                    )}
                  >
                    <span className="font-medium">
                      {notes[d.sn] || `${d.vendor} ${d.model}`}
                    </span>
                    <span className="ml-1.5 text-muted-foreground">
                      {d.serial}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {probing && (
              <span className="text-[12px] text-muted-foreground">
                读取设备信息…
              </span>
            )}
            {probeError && (
              <span className="whitespace-pre-wrap break-all text-[12px] text-red-400">
                {probeError}
              </span>
            )}
            {facts && (
              <>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/40 p-2.5 text-[12px]">
                  <span className="text-muted-foreground">型号</span>
                  <span>
                    {facts.identity.manufacturer} · {facts.identity.model}
                  </span>
                  <span className="text-muted-foreground">系统</span>
                  <span>
                    Android {facts.release}(API {facts.api})
                  </span>
                  <span className="text-muted-foreground">屏幕</span>
                  <span>
                    {facts.width}×{facts.height} · {facts.density} dpi
                  </span>
                  <span className="text-muted-foreground">串口</span>
                  <span className="break-all font-mono text-[11.5px]">
                    {facts.serialPorts.length
                      ? facts.serialPorts
                          .map((p) => p.replace("/dev/", ""))
                          .join(" ")
                      : "没有"}
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-muted-foreground">
                    显示名
                  </span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={60}
                    className={INPUT}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-muted-foreground">
                    模拟器名(模拟器窗口标题,只能用英文)
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value.trim())}
                    spellCheck={false}
                    className={cn(
                      INPUT,
                      "font-mono",
                      nameError && "border-red-500",
                    )}
                  />
                  {nameError && (
                    <span className="text-[12px] text-red-400">
                      {nameError}
                    </span>
                  )}
                </label>
                <span className="text-[12px] text-muted-foreground">
                  本机没有这个系统镜像时会先下载(约 1.5
                  GB)。整个过程会启动、重启模拟器两三次,大约 3~10 分钟
                </span>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {showJob ? (
            <Button variant="outline" onClick={close}>
              {job?.status === "running" ? "后台继续" : "关闭"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                取消
              </Button>
              <Button
                disabled={!facts || !source || !name || !!nameError}
                onClick={() => {
                  if (source) void createFromDevice(source, name, label.trim());
                }}
              >
                开始新建
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobProgress() {
  const job = useEmulatorStore((s) => s.job);
  if (!job) return null;
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {job.steps.map((s, i) => {
        const last = i === job.steps.length - 1;
        const mark =
          !last || job.status === "done"
            ? "✓"
            : job.status === "failed"
              ? "✗"
              : "●";
        return (
          <span
            key={s}
            className={cn(
              last && job.status === "running"
                ? "text-foreground"
                : "text-muted-foreground",
              last && job.status === "failed" && "text-red-400",
            )}
          >
            {mark}
            {s}
          </span>
        );
      })}
      {job.progress && (
        <div className="flex flex-col gap-1 pl-4">
          <Progress value={job.progress.percent} className="h-1.5" />
          <span className="truncate text-[11.5px] text-muted-foreground">
            {job.progress.percent}% {job.progress.text}
          </span>
        </div>
      )}
      {job.status === "done" && (
        <span className="text-emerald-400">
          建好了,已经启动并开始投屏。模拟器名 {job.avd}
        </span>
      )}
      {job.status === "failed" && (
        <span className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[12px] text-red-400">
          {job.message}
        </span>
      )}
    </div>
  );
}
