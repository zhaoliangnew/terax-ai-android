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
import { type DingEntry, upsertGroup } from "./lib/dingtalk";

type Props = {
  /** 要编辑的条目(群或人);null = 关闭。新增就传一个空壳。 */
  group: DingEntry | null;
  onClose: () => void;
  onSaved: (groups: DingEntry[]) => void;
};

/** 加一个常用群或人 —— 只要名字,因为能做的就是把它复制出去搜。 */
export function DingGroupEditDialog({ group, onClose, onSaved }: Props) {
  const [name, setName] = useState(group?.name ?? "");

  useEffect(() => setName(group?.name ?? ""), [group]);

  const commit = () => {
    if (!group) return;
    const trimmed = name.trim();
    // 空名字就当没填,不留空条目。
    if (trimmed) onSaved(upsertGroup({ ...group, name: trimmed }));
    onClose();
  };

  return (
    <Dialog open={group !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">钉钉直达</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            填钉钉里的群名称或人名,要跟搜索时能搜到的一致。
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
          }}
          placeholder="例如:XX产品-研发对接群 / 张三"
          className="h-8 w-full rounded border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring"
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
