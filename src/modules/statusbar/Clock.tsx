import { useEffect, useState } from "react";

function fmt(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** 右下角的时间显示,日期淡一点,时分高亮;每 15 秒对一次表。 */
export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const { date, time } = fmt(now);
  return (
    <span className="flex shrink-0 cursor-default items-center gap-1.5 rounded-full bg-foreground/5 px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
      <span>{date}</span>
      <span className="font-semibold text-foreground">{time}</span>
    </span>
  );
}
