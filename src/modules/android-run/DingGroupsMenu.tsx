import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Delete02Icon,
  Message01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { DingGroupEditDialog } from "./DingGroupEditDialog";
import { DING_COLUMNS } from "./lib/dingDefaults";
import {
  clearCustomGroups,
  type DingEntry,
  isBuiltinEntry,
  loadGroups,
  moveGroup,
  newGroupId,
  removeGroup,
  revealConversation,
} from "./lib/dingtalk";
import {
  MENU_ACTION,
  MENU_EMPTY,
  MENU_HEAD,
  MENU_NOTE,
  MENU_ROW,
  MENU_TRIGGER,
} from "./lib/menuStyles";
import { MenuRowIcon } from "./MenuRowIcon";

type Section = [string, DingEntry[]];

/** 按 team 归类,保持条目原有顺序 —— 顺序是用户自己排的,别打乱。 */
function groupByTeam(entries: DingEntry[]): Section[] {
  const buckets = new Map<string, DingEntry[]>();
  for (const e of entries) {
    const key = e.team ?? "其他";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else buckets.set(key, [e]);
  }
  return [...buckets];
}

/**
 * 按 DING_COLUMNS 把分组摊成列,人少的几组叠在一列里。
 * 没在 DING_COLUMNS 里出现的分组(用户自己加的)全塞进最后一列。
 */
function layOutColumns(sections: Section[]): Section[][] {
  const byName = new Map(sections);
  const placed = new Set<string>();

  const columns = DING_COLUMNS.map((teams) => {
    const col: Section[] = [];
    for (const t of teams) {
      const items = byName.get(t);
      if (items?.length) {
        col.push([t, items]);
        placed.add(t);
      }
    }
    return col;
  }).filter((col) => col.length > 0);

  const rest = sections.filter(([name]) => !placed.has(name));
  if (rest.length > 0) columns.push(rest);
  return columns;
}

/**
 * 常用的群和人。内置那份按组织架构分好组、固定不可改(要动就动 dingDefaults.ts),
 * 用户自己加的排在后面,可增删改排序。
 *
 * 不去拉钉钉那边的全量列表 —— 那玩意儿几十上百个,真正天天要找的就这些。
 */
export function DingGroupsMenu() {
  const [entries, setEntries] = useState<DingEntry[]>(() => loadGroups());
  const [editing, setEditing] = useState<DingEntry | null>(null);

  const columns = layOutColumns(groupByTeam(entries));
  const hasCustom = entries.some((e) => !isBuiltinEntry(e));

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setEntries(loadGroups());
        }}
      >
        <DropdownMenuTrigger asChild>
          <button type="button" title="钉钉直达" className={MENU_TRIGGER}>
            <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
            钉钉直达
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          collisionPadding={8}
          className="w-auto p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className={MENU_HEAD}>
            钉钉直达
            <span className="flex items-center gap-1">
              {hasCustom && (
                <button
                  type="button"
                  title="清空自定义条目(内置的不受影响)"
                  onClick={() => setEntries(clearCustomGroups())}
                  className={MENU_ACTION}
                >
                  清空自定义
                </button>
              )}
              <button
                type="button"
                title="添加"
                onClick={() => setEditing({ id: newGroupId(), name: "" })}
                className={MENU_ACTION}
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
                添加
              </button>
            </span>
          </div>

          {entries.length === 0 && (
            <div className={MENU_EMPTY}>还没有,点右上角添加</div>
          )}

          {/* 三十多条竖着排会超出窗口高度,按分组横着铺 —— 宽度有的是,高度没有。 */}
          <div className="flex items-start divide-x divide-border/50 px-1 pb-2">
            {columns.map((col) => (
              <div key={col[0][0]} className="flex flex-col px-2">
                {col.map(([team, items]) => (
                  <div key={team} className="flex flex-col">
                    <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/70">
                      {team}
                    </div>
                    {items.map((e, i) => {
                      // 内置的是组织架构,不给改不给删;要改就改代码里那份名单。
                      const fixed = isBuiltinEntry(e);
                      return (
                        <div
                          key={e.id}
                          className="group flex items-center gap-1"
                        >
                          <button
                            type="button"
                            title="复制名称并切到钉钉"
                            onClick={() => void revealConversation(e.name)}
                            className={MENU_ROW}
                          >
                            <HugeiconsIcon
                              icon={
                                e.kind === "group" ? UserGroupIcon : UserIcon
                              }
                              size={13}
                              strokeWidth={1.75}
                              className="shrink-0 text-muted-foreground/60"
                            />
                            <span className="whitespace-nowrap">{e.name}</span>
                          </button>
                          {!fixed && (
                            <span className="flex shrink-0 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <MenuRowIcon
                                icon={ArrowUp02Icon}
                                label="上移"
                                disabled={i === 0}
                                onClick={() => setEntries(moveGroup(e.id, -1))}
                              />
                              <MenuRowIcon
                                icon={ArrowDown02Icon}
                                label="下移"
                                disabled={i === items.length - 1}
                                onClick={() => setEntries(moveGroup(e.id, 1))}
                              />
                              <MenuRowIcon
                                icon={PencilEdit02Icon}
                                label="改名"
                                onClick={() => setEditing(e)}
                              />
                              <MenuRowIcon
                                icon={Delete02Icon}
                                label="删除"
                                destructive
                                onClick={() => setEntries(removeGroup(e.id))}
                              />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className={MENU_NOTE}>
            钉钉桌面版不支持外部直接打开会话,点击=复制名称+切到钉钉,粘贴搜索即可。
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <DingGroupEditDialog
        group={editing}
        onClose={() => setEditing(null)}
        onSaved={setEntries}
      />
    </>
  );
}
