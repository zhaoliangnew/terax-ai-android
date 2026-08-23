import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import {
  fallbackTitle,
  type QuickLink,
  upsertQuickLink,
} from "./lib/quickLinks";

type Props = {
  /** 要编辑的入口;null = 关闭。新增就传一个空壳。 */
  link: QuickLink | null;
  onClose: () => void;
  onSaved: (links: QuickLink[]) => void;
};

/** 新增/编辑一个自定义入口。 */
export function QuickLinkEditDialog({ link, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<QuickLink | null>(link);

  // 每次换一个条目重新开,草稿跟着重置。
  useEffect(() => setDraft(link), [link]);

  const commit = () => {
    if (!draft) return;
    const url = draft.url.trim();
    // 地址是空的就当没填,直接关掉,不留空条目。
    if (url) {
      onSaved(
        upsertQuickLink({
          ...draft,
          url,
          title: draft.title.trim() || fallbackTitle(url),
        }),
      );
    }
    onClose();
  };

  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">收藏夹</DialogTitle>
          <DialogDescription className="text-xs">
            贴上云效知识库、钉钉文档之类的地址,点击即用系统浏览器打开。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={draft?.title ?? ""}
            onChange={(e) =>
              setDraft((s) => (s ? { ...s, title: e.target.value } : s))
            }
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="名称(留空则用域名)"
            className="h-8 w-full rounded border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring"
          />
          <input
            value={draft?.url ?? ""}
            onChange={(e) =>
              setDraft((s) => (s ? { ...s, url: e.target.value } : s))
            }
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
            }}
            placeholder="https://alidocs.dingtalk.com/i/nodes/…"
            spellCheck={false}
            className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
          />
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
          <Button size="sm" onClick={commit} className="text-xs">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
