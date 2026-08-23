import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { listInstalledApps } from "./lib/apps";
import { fallbackTitle, type QuickLink } from "./lib/quickLinks";

type Props = {
  /** 要编辑的入口;null = 关闭。新增就传一个空壳。 */
  link: QuickLink | null;
  onClose: () => void;
  /** 存哪张表由调用方决定 —— 收藏夹和 Apifox 各存各的。 */
  onSave: (link: QuickLink) => void;
  /** 弹窗标题,默认"收藏夹"。 */
  title?: string;
  description?: string;
  placeholder?: string;
  /** 允许收藏本机应用(收藏夹开;Apifox 那种只收网址的不开)。 */
  allowApp?: boolean;
};

const INPUT =
  "h-8 w-full rounded border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring";

/** 新增/编辑一个自定义入口。 */
export function QuickLinkEditDialog({
  link,
  onClose,
  onSave,
  title = "收藏夹",
  description = "贴上云效知识库、钉钉文档之类的地址,点击即用系统浏览器打开。",
  placeholder = "https://alidocs.dingtalk.com/i/nodes/…",
  allowApp = false,
}: Props) {
  const [draft, setDraft] = useState<QuickLink | null>(link);
  const [apps, setApps] = useState<{ name: string; path: string }[]>([]);
  const [appQuery, setAppQuery] = useState("");

  // 每次换一个条目重新开,草稿跟着重置。
  useEffect(() => {
    setDraft(link);
    setAppQuery("");
  }, [link]);

  // 打开时才去列 /Applications —— 平时没必要读盘。
  useEffect(() => {
    if (!link || !allowApp) return;
    void listInstalledApps().then(setApps);
  }, [link, allowApp]);

  const isApp = draft?.target === "app";

  const commit = () => {
    if (!draft) return;
    const url = draft.url.trim();
    // 地址是空的就当没填,直接关掉,不留空条目。
    if (url) {
      onSave({
        ...draft,
        url,
        title: draft.title.trim() || fallbackTitle(url),
      });
    }
    onClose();
  };

  const shown = appQuery.trim()
    ? apps.filter((a) =>
        a.name.toLowerCase().includes(appQuery.trim().toLowerCase()),
      )
    : apps;

  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs">
            {isApp ? "挑一个本机应用,以后点一下直接唤起来。" : description}
          </DialogDescription>
        </DialogHeader>

        {allowApp && (
          <div className="flex items-center gap-0.5 self-start rounded-md border border-border p-0.5">
            {(
              [
                [undefined, "网址"],
                ["app", "应用"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  setDraft((s) => (s ? { ...s, target: t, url: "" } : s))
                }
                className={cn(
                  "rounded px-2.5 py-0.5 text-[12px] transition-colors",
                  (draft?.target ?? undefined) === t
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: 新增时第一件事就是起名字
            autoFocus
            value={draft?.title ?? ""}
            onChange={(e) =>
              setDraft((s) => (s ? { ...s, title: e.target.value } : s))
            }
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={
              isApp ? "名称(挑了应用会自动填)" : "名称(留空则用域名)"
            }
            className={INPUT}
          />

          {isApp ? (
            <>
              <input
                value={appQuery}
                onChange={(e) => setAppQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="搜应用…"
                className={INPUT}
              />
              {/* 直接列 /Applications:手敲路径太容易错,而这个列表现成的 */}
              <div className="flex max-h-56 flex-col overflow-y-auto rounded border border-border/60">
                {shown.length === 0 && (
                  <span className="px-2.5 py-3 text-[12px] text-muted-foreground/60">
                    {apps.length === 0 ? "没读到已安装的应用" : "没有匹配的"}
                  </span>
                )}
                {shown.map((a) => (
                  <button
                    key={a.path}
                    type="button"
                    onClick={() =>
                      setDraft((s) =>
                        s
                          ? {
                              ...s,
                              url: a.path,
                              // 名字没自己改过就跟着应用走
                              title: s.title.trim() ? s.title : a.name,
                            }
                          : s,
                      )
                    }
                    className={cn(
                      "px-2.5 py-1.5 text-left text-[13px] hover:bg-accent",
                      draft?.url === a.path && "bg-accent font-medium",
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <input
              value={draft?.url ?? ""}
              onChange={(e) =>
                setDraft((s) => (s ? { ...s, url: e.target.value } : s))
              }
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit();
              }}
              placeholder={placeholder}
              spellCheck={false}
              className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs"
          >
            取消
          </Button>
          <Button
            size="sm"
            onClick={commit}
            disabled={!draft?.url.trim()}
            className="text-xs"
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
