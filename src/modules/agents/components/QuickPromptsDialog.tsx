import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useArmedConfirm } from "@/lib/useArmedConfirm";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_QUICK_PROMPTS,
  groupQuickPrompts,
  MY_GROUP,
  type QuickPrompt,
  useQuickPrompts,
} from "../lib/quickPrompts";

const groupOf = (p: QuickPrompt) => p.group?.trim() || MY_GROUP;

/**
 * 编辑输入框上方的快捷指令。分组做成 tab:能新增、改名、删除分组,每组下
 * 面加、改、删、排序指令,能挪到别的组;能恢复默认。改的是草稿,点保存才生效。
 */
export function QuickPromptsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saved = useQuickPrompts((s) => s.prompts);
  const save = useQuickPrompts((s) => s.save);
  const [draft, setDraft] = useState<QuickPrompt[]>(saved);
  // 新建还没放指令的分组:分组是从指令上算出来的,空组得单独记着才有 tab
  const [emptyGroups, setEmptyGroups] = useState<string[]>([]);
  const [tab, setTab] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useArmedConfirm<string>(3000);
  // 每次打开都从已保存的开始改,取消就当没改过
  useEffect(() => {
    if (!open) return;
    setDraft(saved);
    setEmptyGroups([]);
    setNewGroup(null);
    setTab(null);
  }, [open, saved]);

  const groups = useMemo(() => {
    const list = groupQuickPrompts(draft).map((g) => g.group);
    for (const g of emptyGroups) if (!list.includes(g)) list.push(g);
    return list;
  }, [draft, emptyGroups]);
  const current = tab && groups.includes(tab) ? tab : (groups[0] ?? MY_GROUP);
  const rows = draft
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => groupOf(p) === current);

  const update = (i: number, patch: Partial<QuickPrompt>) =>
    setDraft((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  // 上移/下移只在同一组里换位置
  const neighbor = (cur: QuickPrompt[], i: number, d: -1 | 1) => {
    for (let j = i + d; j >= 0 && j < cur.length; j += d) {
      if (groupOf(cur[j]) === groupOf(cur[i])) return j;
    }
    return -1;
  };
  const move = (i: number, d: -1 | 1) =>
    setDraft((cur) => {
      const j = neighbor(cur, i, d);
      if (j < 0) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addPrompt = () =>
    setDraft((cur) => [
      ...cur,
      {
        id: crypto.randomUUID(),
        label: "",
        text: "",
        group: current === MY_GROUP ? undefined : current,
      },
    ]);
  const commitNewGroup = () => {
    const name = newGroup?.trim();
    setNewGroup(null);
    if (!name) return;
    if (!groups.includes(name)) setEmptyGroups((cur) => [...cur, name]);
    setTab(name);
  };
  const renameGroup = (name: string) => {
    const to = name.trim();
    if (!to || to === current || groups.includes(to)) return;
    setDraft((cur) =>
      cur.map((p) =>
        groupOf(p) === current
          ? { ...p, group: to === MY_GROUP ? undefined : to }
          : p,
      ),
    );
    setEmptyGroups((cur) => cur.map((g) => (g === current ? to : g)));
    setTab(to);
  };
  const deleteGroup = () => {
    setDraft((cur) => cur.filter((p) => groupOf(p) !== current));
    setEmptyGroups((cur) => cur.filter((g) => g !== current));
    setTab(null);
  };
  const valid = draft.filter((p) => p.label.trim() && p.text.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>快捷指令</DialogTitle>
          <DialogDescription>
            点输入框底栏的「快捷指令」选一条发给
            AI。内容里写【提示】的会先弹框让你填。
          </DialogDescription>
        </DialogHeader>

        {/* 分组 tab */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setTab(g)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-[12.5px] transition-colors",
                g === current
                  ? "bg-[#2c67c5] text-white"
                  : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              )}
            >
              {g}
              <span className="ml-1 opacity-60">
                {draft.filter((p) => groupOf(p) === g).length}
              </span>
            </button>
          ))}
          {newGroup === null ? (
            <button
              type="button"
              onClick={() => setNewGroup("")}
              className="flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              新增分组
            </button>
          ) : (
            <input
              autoFocus
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onBlur={commitNewGroup}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewGroup();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setNewGroup(null);
                }
              }}
              placeholder="分组名,回车确定"
              className="h-7 w-36 rounded-md border border-ring bg-transparent px-2 text-[12.5px] outline-none"
            />
          )}
        </div>

        {/* 当前分组:改名、删除 */}
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          分组名
          <input
            key={current}
            defaultValue={current}
            onBlur={(e) => renameGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-7 w-36 rounded-md border border-border bg-transparent px-2 text-[12.5px] text-foreground outline-none focus:border-ring"
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              if (deleteArmed !== current) {
                setDeleteArmed(current);
                return;
              }
              setDeleteArmed(null);
              deleteGroup();
            }}
            className={cn(
              "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 transition-colors",
              deleteArmed === current
                ? "bg-destructive/15 text-destructive"
                : "hover:bg-foreground/10 hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
            {deleteArmed === current
              ? `再点一次删除「${current}」和里面 ${rows.length} 条`
              : "删除分组"}
          </button>
        </div>

        {/* 这一组的指令 */}
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
          {rows.length === 0 && (
            <div className="py-6 text-center text-[12.5px] text-muted-foreground">
              这个分组还没有指令
            </div>
          )}
          {rows.map(({ p, i }) => (
            <div
              key={p.id}
              className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5"
            >
              <div className="flex items-center gap-2">
                <input
                  value={p.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="按钮名"
                  className="h-7 w-48 rounded-md border border-border bg-transparent px-2 text-[12.5px] outline-none focus:border-ring"
                />
                <select
                  value={groupOf(p)}
                  title="挪到别的分组"
                  onChange={(e) =>
                    update(i, {
                      group:
                        e.target.value === MY_GROUP
                          ? undefined
                          : e.target.value,
                    })
                  }
                  className="h-7 rounded-md border border-border bg-transparent px-1.5 text-[12.5px] outline-none focus:border-ring"
                >
                  {(groups.includes(MY_GROUP)
                    ? groups
                    : [...groups, MY_GROUP]
                  ).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <label className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[12px] text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={!!p.confirm}
                    onChange={(e) => update(i, { confirm: e.target.checked })}
                  />
                  点了要二次确认
                </label>
                <span className="flex-1" />
                <IconBtn
                  title="上移"
                  disabled={neighbor(draft, i, -1) < 0}
                  onClick={() => move(i, -1)}
                  icon={ArrowUp01Icon}
                />
                <IconBtn
                  title="下移"
                  disabled={neighbor(draft, i, 1) < 0}
                  onClick={() => move(i, 1)}
                  icon={ArrowDown01Icon}
                />
                <IconBtn
                  title="删除"
                  onClick={() =>
                    setDraft((cur) => cur.filter((_, j) => j !== i))
                  }
                  icon={Delete02Icon}
                />
              </div>
              <textarea
                value={p.text}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder="发给 AI 的话;要先填的地方写成【提示】,点的时候会弹框让你填"
                rows={6}
                className="resize-y rounded-md border border-border bg-transparent px-2 py-1.5 text-[12.5px] leading-relaxed outline-none focus:border-ring"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addPrompt}
            className="flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-border text-[12.5px] text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={1.75} />
            在「{current}」里新增指令
          </button>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(DEFAULT_QUICK_PROMPTS);
              setEmptyGroups([]);
              setTab(null);
            }}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                // 名字或内容空着的那条不存;没指令的空分组也不存
                save(valid);
                onOpenChange(false);
              }}
            >
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconBtn({
  title,
  icon,
  onClick,
  disabled,
}: {
  title: string;
  icon: typeof PlusSignIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:cursor-default disabled:opacity-30"
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
    </button>
  );
}
