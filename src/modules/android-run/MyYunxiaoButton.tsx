import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckListIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { MENU_TRIGGER } from "./lib/menuStyles";
import { openExternally } from "./lib/openExternally";
import { getMyTasksUrl, setMyTasksUrl } from "./lib/yunxiao";

/**
 * 我的云效任务:一键直达自己的待办页。
 *
 * 地址不写死 —— 每个人的待办页 URL 都不一样,填一次存本地。没填过就点开设置,
 * 填过之后点击直达、右键改。
 */
export function MyYunxiaoButton() {
  const [url, setUrl] = useState<string | null>(() => getMyTasksUrl());
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    setMyTasksUrl(draft);
    setUrl(getMyTasksUrl());
    setDraft(null);
  };

  return (
    <>
      <button
        type="button"
        title={
          url ? `我的云效任务 · ${url}(右键改地址)` : "还没设置,点击填地址"
        }
        onClick={() => {
          if (url) openExternally(url);
          else setDraft("");
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setDraft(url ?? "");
        }}
        className={MENU_TRIGGER}
      >
        <HugeiconsIcon icon={CheckListIcon} size={13} strokeWidth={1.75} />
        我的云效任务
      </button>

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">我的云效任务</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              贴上你自己的云效待办页地址,以后点一下直达。
            </DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
            }}
            placeholder="https://devops.aliyun.com/projex/..."
            spellCheck={false}
            className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(null)}
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
    </>
  );
}
