import { rectToVisualScale } from "@/lib/appZoom";
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
  // 照 Codex:最高一档是单独的产品名,不翻译
  ultra: "Ultra",
};

const ULTRA = "ultra";

/** Ultra 档滑条上的星点:位置固定,错开闪,不用随机数免得每次渲染跳。 */
const SPARKS = [
  [6, 30, 0],
  [14, 68, 0.9],
  [23, 42, 1.6],
  [31, 74, 0.4],
  [40, 26, 1.2],
  [48, 58, 2],
  [57, 36, 0.7],
  [65, 70, 1.5],
  [73, 30, 0.2],
  [81, 60, 1.1],
  [89, 40, 1.8],
] as const;

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
  const ultra = value === ULTRA;

  const pick = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    // 界面整体缩放过:量出来的矩形是布局坐标,鼠标 clientX 是视觉坐标,
    // 不换算的话点哪一档都偏,拖起来也跟不上手
    const z = rectToVisualScale();
    const r = el.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - r.left * z) / (r.width * z)),
    );
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
      onPointerCancel={() => {
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
          className={cn(
            "absolute top-0 bottom-0 -left-3.5 overflow-hidden rounded-full transition-[width] duration-100",
            ultra
              ? "bg-[linear-gradient(90deg,#2f3fd0_0%,#6a5cf0_45%,#a578f5_75%,#c9a0fa_100%)]"
              : "bg-[#2c67c5]",
          )}
          style={{ width: `calc(${pct}% + 1.75rem)` }}
        >
          {ultra &&
            SPARKS.map(([x, y, delay]) => (
              <span
                key={`${x}-${y}`}
                className="absolute size-[2px] animate-pulse rounded-full bg-white"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  animationDelay: `${delay}s`,
                }}
              />
            ))}
        </div>
        {!ultra &&
          efforts.map((e, i) => (
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
          className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-[left] duration-100"
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
          <span
            className={cn(
              "text-[13.5px] font-medium",
              (effort ?? current?.defaultEffort) === ULTRA
                ? "text-[#b48cf7]"
                : "text-[#4d8ef7]",
            )}
          >
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
