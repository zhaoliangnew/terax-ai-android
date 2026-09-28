import { cn } from "@/lib/utils";
import {
  ArrowRight01Icon,
  FlashIcon,
  RotateLeft01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import type { ModelOption } from "../store/claudeChatStore";

const EFFORT_LABELS: Record<string, string> = {
  none: "无",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极高",
  ultra: "最高",
};

export function effortLabel(effort: string | null | undefined): string {
  return effort ? (EFFORT_LABELS[effort] ?? effort) : "";
}

/** 快速档在 app-server 里叫 "priority"。 */
const FAST_TIER = "priority";

type Props = {
  model: string | null;
  models: ModelOption[];
  effort: string | null;
  serviceTier: string | null;
  onSetModel: (model: string) => void;
  onSetEffort: (effort: string) => void;
  onSetServiceTier: (tier: string) => void;
  onDone: () => void;
};

/** 推理强度滑条:每档一个点,蓝色铺到当前档,白色圆钮可拖可点。 */
function EffortSlider({
  efforts,
  value,
  onChange,
}: {
  efforts: string[];
  value: string | null;
  onChange: (effort: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const index = Math.max(0, value ? efforts.indexOf(value) : 0);
  const last = Math.max(1, efforts.length - 1);
  const pct = (index / last) * 100;

  const pick = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const next = efforts[Math.round(ratio * last)];
    if (next && next !== value) onChange(next);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="推理强度"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={effortLabel(value)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) pick(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && index > 0) onChange(efforts[index - 1]);
        if (e.key === "ArrowRight" && index < last)
          onChange(efforts[index + 1]);
      }}
      className="relative h-7 cursor-pointer touch-none rounded-full bg-foreground/[0.1] px-3.5 outline-none"
    >
      {/* 圆钮和点都放在去掉两头留白的这一段里,两端的点正好在圆钮中心 */}
      <div ref={trackRef} className="relative h-full">
        <div
          className="absolute top-0 bottom-0 -left-3.5 rounded-full bg-[#2c67c5] transition-[width] duration-150"
          style={{ width: `calc(${pct}% + 1.75rem)` }}
        />
        {efforts.map((e, i) => (
          <span
            key={e}
            className={cn(
              "absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
              i <= index ? "bg-white/70" : "bg-foreground/40",
            )}
            style={{ left: `${(i / last) * 100}%` }}
          />
        ))}
        <span
          className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-[left] duration-150"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Codex 的模型面板(照 Codex 桌面版):上面是快速档开关、当前强度、模型名
 * 和恢复默认,下面是推理强度滑条;点模型名翻到模型列表。
 */
export function CodexModelPanel({
  model,
  models,
  effort,
  serviceTier,
  onSetModel,
  onSetEffort,
  onSetServiceTier,
  onDone,
}: Props) {
  const [view, setView] = useState<"effort" | "models">("effort");
  const current =
    models.find((m) => m.value === model) ?? models.find((m) => m.isDefault);
  const efforts = current?.efforts ?? [];
  const fastTier = current?.tiers?.find((t) => t.id === FAST_TIER);
  const fast = serviceTier === FAST_TIER;
  const recommended = models.find((m) => m.isDefault);

  if (models.length === 0) {
    return (
      <div className="px-3 py-2 text-[12.5px] text-muted-foreground">
        正在读取可用模型…
      </div>
    );
  }

  if (view === "models") {
    return (
      <div className="flex w-64 flex-col">
        <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] text-muted-foreground">
          选择模型
        </div>
        {recommended && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSetModel(recommended.value);
              onDone();
            }}
            className="flex w-full cursor-pointer flex-col rounded-lg px-2.5 py-1.5 text-left hover:bg-foreground/10"
          >
            <span className="text-[13px] font-medium">默认</span>
            <span className="text-[11.5px] text-muted-foreground">
              推荐模型集
            </span>
          </button>
        )}
        {models.map((m) => (
          <button
            key={m.value}
            type="button"
            role="menuitemradio"
            aria-checked={m.value === current?.value}
            onClick={() => {
              onSetModel(m.value);
              onDone();
            }}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-foreground/10"
          >
            {m.displayName}
            {m.value === current?.value && (
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-col gap-3 px-2 pt-2 pb-2.5">
      <div className="flex items-start justify-between">
        <button
          type="button"
          disabled={!fastTier}
          title={
            fastTier
              ? `${fast ? "关闭" : "开启"}快速模式(${fastTier.description})`
              : "这个模型没有快速模式"
          }
          aria-pressed={fast}
          onClick={() => onSetServiceTier(fast ? "default" : FAST_TIER)}
          className={cn(
            "flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-40",
            fast ? "text-[#4d8ef7]" : "text-muted-foreground",
          )}
        >
          <HugeiconsIcon icon={FlashIcon} size={15} strokeWidth={1.75} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-0.5">
          <span className="text-[13.5px] font-medium text-[#4d8ef7]">
            {effortLabel(effort ?? current?.defaultEffort) || "默认"}
          </span>
          <button
            type="button"
            onClick={() => setView("models")}
            className="flex cursor-pointer items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            {current?.displayName ?? model}
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          title="恢复默认强度和速度"
          onClick={() => {
            if (current?.defaultEffort) onSetEffort(current.defaultEffort);
            onSetServiceTier("default");
          }}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={RotateLeft01Icon} size={15} strokeWidth={1.75} />
        </button>
      </div>
      {efforts.length > 1 && (
        <EffortSlider
          efforts={efforts}
          value={effort ?? current?.defaultEffort ?? null}
          onChange={onSetEffort}
        />
      )}
    </div>
  );
}
