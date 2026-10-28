import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { CreateEmulatorDialog } from "./CreateEmulatorDialog";
import { useEmulatorStore } from "./emulatorStore";
import type { AvdInfo } from "./lib/emulator";
import { useAndroidRunStore } from "./store";

const ACTION =
  "rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/** 设备列表顶上的"模拟器"一栏:本机所有 AVD,一键开关,照真机新建。
 * `avds` 是按设备列表的筛选(关键词、搜索、只看在线)过滤后的;筛选中一台都
 * 不剩就整栏不显示。 */
export function EmulatorSection({
  avds,
  filtering,
}: {
  avds: AvdInfo[];
  filtering: boolean;
}) {
  const overview = useEmulatorStore((s) => s.overview);
  const error = useEmulatorStore((s) => s.error);
  const refresh = useEmulatorStore((s) => s.refresh);
  const job = useEmulatorStore((s) => s.job);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (filtering && avds.length === 0) return null;
  if (!overview?.sdkRoot && !overview?.avds.length) {
    return error ? (
      <div className="px-1 pb-2 text-[12px] text-muted-foreground">
        模拟器不可用:{error}
      </div>
    ) : null;
  }

  return (
    <section className="mb-3">
      <div className="flex items-center gap-2 pb-2 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground/80">模拟器</span>
        <span>
          {filtering && avds.length !== overview.avds.length
            ? `${avds.length} / ${overview.avds.length}`
            : overview.avds.length}{" "}
          台
        </span>
        <span className="h-px flex-1 bg-border/70" />
        {job?.status === "running" && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-sky-400 hover:underline"
          >
            正在新建 {job.avd}…
          </button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[12px]"
          disabled={!!overview.createBlocker}
          title={
            overview.createBlocker ??
            "选一台在线真机,建一台系统、分辨率、型号和串口都一样的模拟器"
          }
          onClick={() => setCreating(true)}
        >
          + 照真机新建
        </Button>
      </div>
      {overview.avds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
          本机还没有模拟器。连上一台真机后点「照真机新建」
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-2.5">
          {avds.map((a) => (
            <EmulatorCard key={a.name} avd={a} />
          ))}
        </div>
      )}
      {creating && <CreateEmulatorDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

function EmulatorCard({ avd }: { avd: AvdInfo }) {
  const running = useEmulatorStore(
    (s) => s.overview?.running.find((r) => r.avd === avd.name) ?? null,
  );
  const busy = useEmulatorStore((s) => s.busy[avd.name]);
  const failure = useEmulatorStore((s) => s.failures[avd.name]);
  const prepared = useEmulatorStore((s) =>
    running ? s.prepared[running.serial] : undefined,
  );
  const prepareError = useEmulatorStore((s) =>
    running ? s.prepareErrors[running.serial] : undefined,
  );
  const { start, stop, remove, ensurePrepared } = useEmulatorStore.getState();
  const selectDevice = useAndroidRunStore((s) => s.selectDevice);
  const setMirroring = useAndroidRunStore((s) => s.setMirroring);
  const setOpen = useAndroidRunStore((s) => s.setDeviceManagerOpen);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const p = avd.profile;
  const online = !!running?.booted;
  const status =
    busy ?? (online ? "运行中" : running ? "系统启动中…" : "未启动");

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-1.5 rounded-xl border p-3.5",
        online ? "border-emerald-500/40" : "border-border",
      )}
    >
      <span
        className={cn(
          "absolute top-2 right-2 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
          online && !busy
            ? "bg-emerald-500/20 text-emerald-400"
            : busy || running
              ? "bg-sky-500/15 text-sky-400"
              : "bg-muted-foreground/15 text-muted-foreground",
        )}
      >
        {status}
      </span>
      <span className="truncate pr-16 text-[15px] font-semibold">
        {avd.displayName}
      </span>
      <span className="truncate text-[13px] text-muted-foreground">
        {p ? `${p.identity.manufacturer} · ${p.identity.model}` : avd.name}
        {avd.api ? ` · API ${avd.api}` : ""}
        {avd.width && avd.height ? ` · ${avd.width}×${avd.height}` : ""}
      </span>
      {p && (
        <span className="truncate text-[12px] text-muted-foreground/80">
          照 {p.sourceLabel || p.sourceSn} 建 · {p.serialPorts.length} 个串口
          {running ? ` · ${running.serial}` : ""}
        </span>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {running ? (
          <>
            {online && (
              <button
                type="button"
                className={ACTION}
                onClick={() => {
                  selectDevice(running.serial);
                  setMirroring(true);
                  setOpen(false);
                }}
              >
                投屏
              </button>
            )}
            <button
              type="button"
              className={ACTION}
              disabled={!!busy}
              onClick={() => void stop(avd.name)}
            >
              关闭
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void start(avd.name)}
            className="rounded bg-emerald-600 px-2 py-0.5 text-[12px] text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            启动
          </button>
        )}
        {p && running && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(ACTION, prepareError && "text-yellow-500")}
              >
                串口 {prepared ? prepared.ports.length : "…"}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="z-[60] w-80 p-3">
              <div className="mb-2 text-[12px] text-muted-foreground">
                模拟器里的串口 ⇄ 电脑上的 TCP 端口。用调试工具连 127.0.0.1
                对应端口,就能和 app 收发数据
              </div>
              {prepareError && (
                <div className="mb-2 whitespace-pre-wrap break-all text-[12px] text-yellow-500">
                  {prepareError}
                </div>
              )}
              {prepared && (
                <div className="grid max-h-64 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 overflow-auto font-mono text-[12px]">
                  {prepared.ports.map((m) => (
                    <PortRow
                      key={m.path}
                      path={m.path}
                      hostPort={m.hostPort}
                      scale={m.path === prepared.scalePort}
                    />
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-7 w-full text-[12px]"
                onClick={() => void ensurePrepared(running.serial, true, true)}
              >
                重建串口
              </Button>
            </PopoverContent>
          </Popover>
        )}
        {!running &&
          (confirmDelete ? (
            <span className="ml-auto flex items-center gap-1 text-[12px]">
              <span className="text-muted-foreground">删掉模拟器和数据?</span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-500/15"
                onClick={() => void remove(avd.name)}
              >
                删除
              </button>
              <button
                type="button"
                className={ACTION}
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={cn(
                ACTION,
                "ml-auto opacity-0 group-hover:opacity-100 hover:text-red-400",
              )}
              disabled={!!busy}
              onClick={() => setConfirmDelete(true)}
            >
              删除
            </button>
          ))}
      </div>
      {failure && (
        <div className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[12px] text-red-400">
          {failure}
        </div>
      )}
    </div>
  );
}

function PortRow({
  path,
  hostPort,
  scale,
}: {
  path: string;
  hostPort: number;
  scale: boolean;
}) {
  return (
    <>
      <span className={cn(scale && "text-emerald-400")}>
        {path}
        {scale && <span className="ml-1.5 font-sans text-[11px]">电子秤</span>}
      </span>
      <span className="text-muted-foreground">{hostPort}</span>
    </>
  );
}
