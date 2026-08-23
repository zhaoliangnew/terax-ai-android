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

type Props = {
  /** 当前值;null = 关闭。空串 = 新填。 */
  value: string | null;
  title: string;
  description: string;
  placeholder?: string;
  onClose: () => void;
  onSave: (url: string) => void;
};

/** 只要一个地址的小弹窗。 */
export function UrlPromptDialog({
  value,
  title,
  description,
  placeholder = "https://devops.aliyun.com/projex/...",
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
          }}
          placeholder={placeholder}
          spellCheck={false}
          className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
        />
        <DialogFooter>
          {/* 清空 = 存空串,按钮就藏回去了 */}
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
