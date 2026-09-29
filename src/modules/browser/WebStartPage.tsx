import { loadQuickLinks } from "@/modules/android-run/lib/quickLinks";
import { Cancel01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  loadRecentSites,
  type RecentSite,
  removeRecentSite,
} from "./lib/recentSites";

/** 网址的主机名,当副标题;解析不了就原样。 */
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 标题首字当图标:内网系统大多没 favicon,拉外部图标服务也拿不到。 */
function Badge({ text }: { text: string }) {
  const ch = text.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.08] text-[15px] font-medium text-foreground/80">
      {ch}
    </span>
  );
}

/**
 * 新标签页(照 Codex 的新标签页):常用入口 + 最近访问,点一下就在这个
 * 标签页里打开。常用入口就是工具栏"知识库"里那一份(内置 + 自己加的)。
 */
export function WebStartPage({
  onOpen,
  error,
}: {
  onOpen: (url: string) => void;
  error: string | null;
}) {
  const links = loadQuickLinks().filter(
    (l) => l.target !== "app" && /^https?:/i.test(l.url),
  );
  const [recent, setRecent] = useState<RecentSite[]>(loadRecentSites);

  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-9">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12.5px] text-red-400">
            {error}
          </div>
        )}
        {links.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[13px] font-medium text-muted-foreground">
              常用
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {links.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  title={l.url}
                  onClick={() => onOpen(l.url)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.06]"
                >
                  <Badge text={l.title} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {l.title}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            最近访问
          </h2>
          {recent.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-[12.5px] text-muted-foreground/80">
              <HugeiconsIcon icon={Globe02Icon} size={15} strokeWidth={1.5} />
              在上面输入网址,比如 baidu.com 或 39.100.83.89:40135
            </div>
          ) : (
            <div className="flex flex-col">
              {recent.map((s) => (
                <div
                  key={s.url}
                  className="group/recent flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/[0.06]"
                >
                  <button
                    type="button"
                    title={s.url}
                    onClick={() => onOpen(s.url)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                  >
                    <Badge text={s.title} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px]">{s.title}</span>
                      <span className="truncate text-[11.5px] text-muted-foreground">
                        {host(s.url)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="从最近访问里删掉"
                    onClick={() => setRecent(removeRecentSite(s.url))}
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity hover:bg-foreground/10 group-hover/recent:opacity-70 hover:!opacity-100"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={12}
                      strokeWidth={2}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
