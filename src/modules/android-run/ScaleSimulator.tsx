import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEffect, useId, useState } from "react";
import { useEmulatorStore } from "./emulatorStore";
import { formatGrams, type ScaleProtocol } from "./lib/emulator";

const MAX_G = 30_000;
const PRESETS = [0, 100, 500, 1000, 2500, 5000, 10_000];
const SELECT =
  "h-7 rounded-md border border-input bg-transparent px-1.5 text-[12px] outline-none focus:border-ring";

/** 投屏栏上的"电子秤":往模拟器的秤串口持续发重量,app 发来的去皮/置零也会应答。 */
export function ScaleSimulator({ serial }: { serial: string }) {
  const sim = useEmulatorStore((s) => s.scales[serial]);
  const prepared = useEmulatorStore((s) => s.prepared[serial]);
  const prepareError = useEmulatorStore((s) => s.prepareErrors[serial]);
  const { ensurePrepared, startScale, stopScale, setLoad } =
    useEmulatorStore.getState();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const shakeId = useId();
  const overId = useId();

  useEffect(() => {
    if (open) void ensurePrepared(serial);
  }, [open, serial, ensurePrepared]);

  const gross = sim?.grossG;
  useEffect(() => {
    if (gross !== undefined) setInput(String(gross));
  }, [gross]);

  const snap = sim?.snapshot;
  const ports = prepared?.ports ?? [];
  const port = sim?.port ?? prepared?.scalePort ?? ports[0]?.path ?? "";
  const protocol = sim?.protocol ?? prepared?.scaleProtocol ?? "xyd2";
  const live = !!snap?.connected;

  const commitInput = () => {
    const g = Math.round(Number(input));
    if (sim && Number.isFinite(g)) setLoad(serial, { grossG: g });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="模拟电子秤:往秤串口发重量"
          className={cn(
            "flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:text-foreground",
            sim && "border-emerald-500/50 text-emerald-400",
          )}
        >
          {sim && (
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-emerald-400" : "bg-yellow-500",
              )}
            />
          )}
          电子秤{sim && snap ? ` ${formatGrams(snap.netG)}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        {!prepared && !prepareError && (
          <div className="text-[12px] text-muted-foreground">准备串口…</div>
        )}
        {prepareError && (
          <div className="whitespace-pre-wrap break-all text-[12px] text-yellow-500">
            {prepareError}
          </div>
        )}
        {prepared && ports.length === 0 && (
          <div className="text-[12px] text-muted-foreground">
            这台模拟器没有串口。用设备列表里的「照真机新建」建的模拟器才有
          </div>
        )}
        {ports.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5">
              <select
                value={port}
                onChange={(e) =>
                  void startScale(serial, e.target.value, protocol)
                }
                className={cn(SELECT, "min-w-0 flex-1 font-mono")}
                title="秤接在哪个串口"
              >
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}
                  </option>
                ))}
              </select>
              <select
                value={protocol}
                onChange={(e) =>
                  void startScale(serial, port, e.target.value as ScaleProtocol)
                }
                className={SELECT}
                title="称重模块协议,app 设置里的电子秤版本"
              >
                <option value="xyd2">协议 2.0</option>
                <option value="xyd1">协议 1.0</option>
              </select>
              {sim ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[12px]"
                  onClick={() => stopScale(serial)}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 px-2 text-[12px]"
                  onClick={() => void startScale(serial, port, protocol)}
                >
                  开启
                </Button>
              )}
            </div>

            {sim && (
              <>
                <div className="flex items-end justify-between rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      {formatGrams(snap?.netG ?? 0)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {snap?.tareG ? `皮重 ${formatGrams(snap.tareG)} · ` : ""}
                      {live
                        ? snap?.lastCommand
                          ? `app 刚才:${snap.lastCommand}`
                          : "已连上串口"
                        : "连不上串口,试试设备列表里的「重建串口」"}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px]",
                      snap?.stable
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-yellow-500/15 text-yellow-500",
                    )}
                  >
                    {snap?.stable ? "稳定" : "不稳定"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    秤上放了
                  </span>
                  <input
                    value={input}
                    inputMode="numeric"
                    onChange={(e) =>
                      setInput(e.target.value.replace(/[^\d-]/g, ""))
                    }
                    onBlur={commitInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitInput();
                    }}
                    className="h-7 w-24 rounded-md border border-input bg-transparent px-2 text-right font-mono text-[13px] outline-none focus:border-ring"
                  />
                  <span className="text-[12px] text-muted-foreground">克</span>
                </div>
                <Slider
                  min={0}
                  max={MAX_G}
                  step={10}
                  value={[Math.min(Math.max(sim.grossG, 0), MAX_G)]}
                  onValueChange={([v]) => setLoad(serial, { grossG: v })}
                />
                <div className="flex flex-wrap gap-1">
                  {PRESETS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setLoad(serial, { grossG: g })}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[11.5px]",
                        sim.grossG === g
                          ? "border-emerald-500/60 text-emerald-400"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g === 0 ? "空秤" : formatGrams(g)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  <span className="flex items-center gap-1.5">
                    <Switch
                      id={shakeId}
                      checked={sim.shaking}
                      onCheckedChange={(v) => setLoad(serial, { shaking: v })}
                    />
                    <label htmlFor={shakeId}>晃动</label>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Switch
                      id={overId}
                      checked={sim.over}
                      onCheckedChange={(v) => setLoad(serial, { over: v })}
                    />
                    <label htmlFor={overId}>超载</label>
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    127.0.0.1:{sim.hostPort}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
