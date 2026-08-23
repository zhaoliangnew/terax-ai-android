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
  type DingEntry,
  loadGroups,
  newGroupId,
  resolveGroupBinding,
  setGroupBinding,
  upsertGroup,
} from "./lib/dingtalk";

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

/** 给一个目录绑定钉钉群,目录下所有工程都继承。 */
export function DingGroupPickerDialog({ dir, onClose, onSaved }: Props) {
  const [groups, setGroups] = useState<DingEntry[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (dir !== null) {
      setGroups(loadGroups());
      setDraft("");
    }
  }, [dir]);

  const key = dir?.replace(/\/+$/, "") ?? null;
  const current = dir ? resolveGroupBinding(dir) : null;
  const bound = current?.dir === key ? current : null;

  const bind = (name: string) => {
    if (!dir) return;
    setGroupBinding(dir, name);
    onSaved?.();
    onClose();
  };

  // 列表里没有就现加一个,省得先去别处建再回来选。
  const bindNew = () => {
    const name = draft.trim();
    if (!name) return;
    upsertGroup({ id: newGroupId(), name });
    bind(name);
  };

  const unbind = () => {
    if (!dir) return;
    setGroupBinding(dir, null);
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={dir !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">关联钉钉群</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            绑定到目录{" "}
            <span className="font-medium text-foreground">
              {dir ? basename(dir) : ""}
            </span>
            ,里面所有工程都会继承这个群。
            {bound && (
              <>
                <br />
                当前:<span className="text-foreground">{bound.name}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 min-h-16 overflow-y-auto rounded border border-border/60">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-muted-foreground">
              还没有常用群,下面直接填一个。
            </div>
          )}
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => bind(g.name)}
              className="flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") bindNew();
            }}
            placeholder="或直接填一个新的群名…"
            className="h-8 min-w-0 flex-1 rounded border border-input bg-transparent px-2 text-[13px] outline-none focus:border-ring"
          />
          <Button
            size="sm"
            disabled={!draft.trim()}
            onClick={bindNew}
            className="h-8 text-xs"
          >
            添加并绑定
          </Button>
        </div>

        <DialogFooter>
          {bound && (
            <Button
              variant="ghost"
              size="sm"
              onClick={unbind}
              className="mr-auto text-xs text-muted-foreground hover:text-red-400"
            >
              解除关联
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs"
          >
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
