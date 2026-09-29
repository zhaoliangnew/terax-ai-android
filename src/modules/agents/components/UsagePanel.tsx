import { cn } from "@/lib/utils";
import { resetLabel, type UsageInfo } from "../lib/usage";

/** 用得越多颜色越警示:过八成橙,满了红。 */
function barColor(percent: number): string {
  if (percent >= 100) return "bg-red-500";
  if (percent >= 80) return "bg-orange-400";
  return "bg-[#2c67c5]";
}

/**
 * 套餐用量(和 Claude 的 /usage、Codex 的额度一样的数据):每个窗口一条
 * 进度,下面写什么时候重置。
 */
export function UsagePanel({
  agentName,
  usage,
}: {
  agentName: string;
  /** undefined = 正在查;null = 查不到。 */
  usage: UsageInfo | null | undefined;
}) {
  return (
    <div className="flex w-72 flex-col gap-3 px-2.5 pt-2 pb-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{agentName} 用量</span>
        {usage?.plan && (
          <span className="text-[11.5px] text-muted-foreground capitalize">
            {usage.plan} 套餐
          </span>
        )}
      </div>
      {usage === undefined && (
        <div className="text-[12.5px] text-muted-foreground">正在读取…</div>
      )}
      {usage === null && (
        <div className="text-[12.5px] text-muted-foreground">
          读不到用量,会话启动好了再试
        </div>
      )}
      {usage?.notes?.map((n) => (
        <div key={n} className="text-[12.5px] text-muted-foreground">
          {n}
        </div>
      ))}
      {usage && usage.windows.length === 0 && !usage.notes?.length && (
        <div className="text-[12.5px] text-muted-foreground">
          这个账号没有套餐额度(按量计费)
        </div>
      )}
      {usage?.windows.map((w) => (
        <div key={w.label} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-[12.5px]">
            <span>{w.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(w.percent)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.1]">
            <div
              className={cn("h-full rounded-full", barColor(w.percent))}
              style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }}
            />
          </div>
          {w.resetsAt && (
            <span className="text-[11px] text-muted-foreground/80">
              {resetLabel(w.resetsAt)} 重置
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
