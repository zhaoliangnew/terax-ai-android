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
import { getProjectLink, setProjectLink } from "./lib/yunxiao";

type Props = {
  /** 要绑定的目录;null = 关闭。 */
  dir: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** 给一个目录绑定云效项目地址。目录下所有工程都会继承这个链接。 */
export function YunxiaoLinkDialog({ dir, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (dir) setDraft(getProjectLink(dir) ?? "");
  }, [dir]);

  const commit = () => {
    if (!dir) return;
    setProjectLink(dir, draft);
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={dir !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">关联云效项目</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            绑定到目录{" "}
            <span className="font-medium text-foreground">
              {dir ? basename(dir) : ""}
            </span>
            ,里面所有工程都会继承这个链接。留空则解除关联。
          </DialogDescription>
        </DialogHeader>
        {/* biome-ignore lint/a11y/noAutofocus: 打开就是为了粘贴 */}
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
          }}
          placeholder="https://devops.aliyun.com/projex/project/…"
          spellCheck={false}
          className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
        />
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
