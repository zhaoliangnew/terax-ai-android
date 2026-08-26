import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowDown01Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { MENU_HEAD, MENU_NOTE, MENU_TRIGGER } from "./lib/menuStyles";
import { openExternally } from "./lib/openExternally";
import {
  clearRecentEnvs,
  ENV_COUNT,
  ENV_HOST,
  ENV_KINDS,
  envName,
  envUrl,
  loadRecentEnvs,
  pushRecentEnv,
} from "./lib/testEnvs";

const NUMBERS = Array.from({ length: ENV_COUNT }, (_, i) => i + 1);

/**
 * 测试环境直达:dev01…dev50 / test01…test50,点一下用浏览器打开。
 *
 * 两档全摊开摆着,不做切换 —— 一天要在 dev 和 test 之间来回跳,多一次点击就多一次
 * 找位置。一百个地址也不存清单:它们只差编号,名字现算就行。
 */
export function TestEnvMenu() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  // 读 localStorage 是副作用,不能在渲染期算(React Compiler 会按回调里
  // 用到的变量重推依赖,手写的依赖数组不算数),每次打开时同步一次。
  useEffect(() => {
    if (!open) return;
    setRecent(loadRecentEnvs());
  }, [open]);

  const go = (name: string) => {
    openExternally(envUrl(name));
    setRecent(pushRecentEnv(name));
    setOpen(false);
  };

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="测试环境直达" className={MENU_TRIGGER}>
          <HugeiconsIcon
            icon={ServerStack01Icon}
            size={13}
            strokeWidth={1.75}
          />
          测试环境
          <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[46rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className={MENU_HEAD}>测试环境</div>

        {recent.length > 0 && (
          <div className="border-b border-border/50 px-4 pb-2.5">
            <div className="flex items-center justify-between pb-1.5 text-[11.5px] text-muted-foreground/70">
              最近
              <button
                type="button"
                onClick={() => setRecent(clearRecentEnvs())}
                className="rounded px-1 hover:bg-accent hover:text-foreground"
              >
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={envUrl(name)}
                  onClick={() => go(name)}
                  className="rounded border border-border/70 px-2 py-1 text-[12.5px] tabular-nums hover:bg-accent"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {ENV_KINDS.map(({ kind, label }) => (
          <div key={kind} className="px-4 pt-2.5 pb-1">
            <div className="pb-1.5 text-[11.5px] font-medium text-muted-foreground/70">
              {label}
            </div>
            <div className="grid grid-cols-10 gap-1.5">
              {NUMBERS.map((n) => {
                const name = envName(kind, n);
                return (
                  <button
                    key={name}
                    type="button"
                    title={envUrl(name)}
                    onClick={() => go(name)}
                    className="flex h-7 items-center justify-center rounded border border-transparent text-[12.5px] tabular-nums text-foreground/80 transition-colors hover:border-border hover:bg-accent hover:text-foreground"
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className={`${MENU_NOTE} mt-2`}>
          地址规则:https://<span className="text-foreground/70">dev01</span>.
          {ENV_HOST},点一下用浏览器打开(已开着的标签页直接切过去)。
        </div>
      </PopoverContent>
    </Popover>
  );
}
