import { cn } from "@/lib/utils";
import {
  AiNetworkIcon,
  ArrowRight01Icon,
  RotateLeft01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { findModel } from "../lib/modelMatch";
import type { ModelOption } from "../store/claudeChatStore";
import { EffortSlider, PanelHint } from "./CodexModelPanel";

/** 模型没报支持哪几档时的兜底。 */
const FALLBACK_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** 每档的特点,照 SDK 文档(EffortLevel / ultracode 的注释)。 */
const EFFORT_NOTES: Record<string, string> = {
  auto: "不指定,用当前模型的默认档",
  low: "思考最少,回得最快,适合简单问答",
  medium: "适度思考,改几行代码够用",
  high: "深度推理",
  xhigh: "比 high 想得更深,新模型才有,不支持的退回 high",
  max: "最大强度,只有部分模型支持,最慢最费额度",
  ultracode: "按 xhigh 跑 + 多代理工作流编排,大任务用,消耗大很多",
};

type Props = {
  model: string | null;
  models: ModelOption[];
  effort: string | null;
  ultracode: boolean;
  /** 会话报的实际强度;还没报是 null。 */
  appliedEffort: string | null;
  ultracodeAvailable: boolean;
  onSetModel: (model: string) => void;
  /** "" = 回到 auto。 */
  onSetEffort: (effort: string) => void;
  onSetUltracode: (on: boolean) => void;
};

/**
 * Claude 的模型面板,和 Codex 那块同一个样子:左上 ultracode 开关(和
 * 强度是两个设置),中间当前强度和模型名,右上恢复默认,下面强度滑条。
 * 强度显示 SDK 的原值(low…max),滑条下一行写这一档的特点。
 */
export function ClaudeModelPanel({
  model,
  models,
  effort,
  ultracode,
  appliedEffort,
  ultracodeAvailable,
  onSetModel,
  onSetEffort,
  onSetUltracode,
}: Props) {
  const [view, setView] = useState<"effort" | "models">("effort");
  const current = model ? findModel(model, models) : undefined;
  // 模型报了支持哪几档就按它(Haiku 报的是不支持,空列表);没找到才兜底
  const efforts = current?.efforts ?? FALLBACK_EFFORTS;
  // ultracode 要求模型支持 xhigh
  const canUltra = ultracodeAvailable && efforts.includes("xhigh");
  const shown = ultracode ? "ultracode" : (effort ?? "auto");
  // auto 时实际跑哪档要看会话报的(Opus 5.5 是 medium),报了就写出来
  const actual = !ultracode && !effort ? appliedEffort : null;

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
        {models.map((m) => (
          <button
            key={m.value}
            type="button"
            role="menuitemradio"
            aria-checked={m === current}
            onClick={() => {
              onSetModel(m.value);
              // 选完回到强度页(新模型支持的档位可能不一样),菜单不关
              setView("effort");
            }}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-foreground/10"
          >
            {m.displayName}
            {m === current && (
              <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    // 比 Codex 那块宽:滑条下的说明要一行放下,不折行
    <div className="flex w-[22rem] flex-col gap-3 px-2 pt-2 pb-2.5">
      <div className="flex items-start justify-between">
        <PanelHint
          title={
            canUltra
              ? `ultracode${ultracode ? " · 已开启" : ""}`
              : "不能开 ultracode"
          }
          detail={
            canUltra
              ? "xhigh + 多代理工作流,用量大很多"
              : "这个模型不支持(要能跑 xhigh)"
          }
        >
          <button
            type="button"
            disabled={!canUltra}
            aria-label="ultracode"
            aria-pressed={ultracode}
            onClick={() => onSetUltracode(!ultracode)}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-foreground/10 disabled:cursor-default disabled:opacity-40",
              ultracode ? "text-[#b48cf7]" : "text-muted-foreground",
            )}
          >
            <HugeiconsIcon icon={AiNetworkIcon} size={15} strokeWidth={1.75} />
          </button>
        </PanelHint>
        <div className="flex min-w-0 flex-col items-center gap-0.5">
          <span
            className={cn(
              "font-mono text-[13.5px] font-medium",
              ultracode ? "text-[#b48cf7]" : "text-[#4d8ef7]",
            )}
          >
            {shown}
            {actual && (
              <span className="text-muted-foreground"> · {actual}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setView("models")}
            className="flex cursor-pointer items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            {current?.displayName ?? model ?? "默认模型"}
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          title="恢复默认:强度回到 auto,关掉 ultracode"
          onClick={() => {
            onSetEffort("");
            if (ultracode) onSetUltracode(false);
          }}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={RotateLeft01Icon} size={15} strokeWidth={1.75} />
        </button>
      </div>
      {efforts.length > 1 ? (
        <>
          <EffortSlider
            efforts={efforts}
            // 圆钮停在选的那档;auto 时停在会话报的实际档上。开着
            // ultracode 也照样显示底下选的强度(关掉后回到它),只是换成紫色
            value={effort ?? appliedEffort}
            onChange={onSetEffort}
            ultra={ultracode}
            formatLabel={(e) => e ?? "auto"}
          />
          <div className="-mt-1.5 truncate px-1 text-center text-[11px] whitespace-nowrap text-muted-foreground">
            {EFFORT_NOTES[shown]}
            {actual && `(现在是 ${actual})`}
          </div>
        </>
      ) : (
        <div className="px-1 text-center text-[11px] text-muted-foreground">
          这个模型不支持调推理强度
        </div>
      )}
    </div>
  );
}
