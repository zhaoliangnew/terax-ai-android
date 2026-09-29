/** 套餐额度的一个窗口(5 小时、每周……)。 */
export type UsageWindow = {
  label: string;
  /** 0-100。 */
  percent: number;
  /** 毫秒时间戳;不知道就是 null。 */
  resetsAt: number | null;
};

export type UsageInfo = {
  /** 套餐名(max / pro …);按量计费的账号是 null。 */
  plan: string | null;
  windows: UsageWindow[];
  /** 没有额度百分比时给的几句说明(Qoder:本次会话用了多少 credits)。 */
  notes?: string[];
};

type ClaudeLimit = {
  kind?: string;
  percent?: number | null;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
};
type ClaudeWindow = { utilization?: number | null; resets_at?: string | null };

export type ClaudeUsage = {
  subscriptionType?: string | null;
  notes?: string[];
  available?: boolean;
  rateLimits?: {
    limits?: ClaudeLimit[];
    five_hour?: ClaudeWindow | null;
    seven_day?: ClaudeWindow | null;
  } | null;
} | null;

const iso = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/** Claude 的 `/usage` 数据 → 窗口列表。优先用服务端整理好的 `limits`。 */
export function claudeUsage(u: ClaudeUsage): UsageInfo {
  const plan = u?.subscriptionType ?? null;
  if (u?.notes?.length) return { plan, windows: [], notes: u.notes };
  const rl = u?.available ? u.rateLimits : null;
  if (!rl) return { plan, windows: [] };
  const windows: UsageWindow[] = [];
  for (const l of rl.limits ?? []) {
    if (l.percent == null) continue;
    const model = l.scope?.model?.display_name;
    const label =
      l.kind === "session"
        ? "5 小时"
        : l.kind === "weekly_all"
          ? "每周(所有模型)"
          : l.kind === "weekly_scoped"
            ? `每周 ${model ?? ""}`.trim()
            : (l.kind ?? "");
    windows.push({ label, percent: l.percent, resetsAt: iso(l.resets_at) });
  }
  if (windows.length) return { plan, windows };
  const push = (label: string, w: ClaudeWindow | null | undefined) => {
    if (w?.utilization != null) {
      windows.push({
        label,
        percent: w.utilization,
        resetsAt: iso(w.resets_at),
      });
    }
  };
  push("5 小时", rl.five_hour);
  push("每周", rl.seven_day);
  return { plan, windows };
}

type CodexWindow = {
  usedPercent?: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
} | null;
export type CodexSnapshot = {
  limitName?: string | null;
  primary?: CodexWindow;
  secondary?: CodexWindow;
  planType?: string | null;
};

function durationLabel(mins: number | null | undefined): string {
  if (!mins) return "额度";
  if (mins % 1440 === 0) return mins === 10080 ? "每周" : `${mins / 1440} 天`;
  if (mins % 60 === 0) return `${mins / 60} 小时`;
  return `${mins} 分钟`;
}

/** Codex 的额度快照(可能分好几个桶)→ 窗口列表。 */
export function codexUsage(
  snapshots: readonly (CodexSnapshot | null | undefined)[],
): UsageInfo {
  let plan: string | null = null;
  const windows: UsageWindow[] = [];
  const named = snapshots.filter(Boolean).length > 1;
  for (const s of snapshots) {
    if (!s) continue;
    plan = plan ?? s.planType ?? null;
    for (const w of [s.primary, s.secondary]) {
      if (!w || w.usedPercent == null) continue;
      const base = durationLabel(w.windowDurationMins);
      windows.push({
        label: named && s.limitName ? `${s.limitName} ${base}` : base,
        percent: w.usedPercent,
        resetsAt: w.resetsAt ? w.resetsAt * 1000 : null,
      });
    }
  }
  return { plan, windows };
}

/** "今天 18:00" / "明天 09:30" / "10月5日 10:59"。 */
export function resetLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const hm = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return `今天 ${hm}`;
  if (day(ts) === day(now + 86_400_000)) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
