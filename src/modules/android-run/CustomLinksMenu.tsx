import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Bookmark02Icon,
  ComputerIcon,
  Delete02Icon,
  Link02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  MENU_ACTION,
  MENU_EMPTY,
  MENU_HEAD,
  MENU_ROW,
  MENU_TRIGGER,
} from "./lib/menuStyles";
import {
  loadQuickLinks,
  moveQuickLink,
  newLinkId,
  openQuickLink,
  type QuickLink,
  removeQuickLink,
  upsertQuickLink,
} from "./lib/quickLinks";
import { MenuRowIcon } from "./MenuRowIcon";
import { QuickLinkEditDialog } from "./QuickLinkEditDialog";

/** 自己攒的入口:网址和本机应用都能放,跟内置知识库分开管,可增删改排序。 */
export function CustomLinksMenu() {
  const [links, setLinks] = useState<QuickLink[]>(() => loadQuickLinks());
  const [editing, setEditing] = useState<QuickLink | null>(null);

  const custom = links.filter((l) => !l.kind);

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          // 弹窗里改过就同步回来。
          if (open) setLinks(loadQuickLinks());
        }}
      >
        <DropdownMenuTrigger asChild>
          <button type="button" title="收藏夹" className={MENU_TRIGGER}>
            <HugeiconsIcon icon={Bookmark02Icon} size={13} strokeWidth={1.75} />
            收藏夹
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-80 p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className={MENU_HEAD}>
            收藏夹
            <button
              type="button"
              title="添加收藏"
              onClick={() =>
                setEditing({ id: newLinkId(), title: "", url: "" })
              }
              className={MENU_ACTION}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              添加
            </button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto px-1.5 pb-2">
            {custom.length === 0 && (
              <div className={MENU_EMPTY}>还没有,点右上角添加</div>
            )}
            {custom.map((l, i) => (
              <div key={l.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  title={l.target === "app" ? `打开 ${l.url}` : l.url}
                  onClick={() => openQuickLink(l)}
                  className={MENU_ROW}
                >
                  <HugeiconsIcon
                    icon={l.target === "app" ? ComputerIcon : Link02Icon}
                    size={13}
                    strokeWidth={1.75}
                    className="shrink-0 text-muted-foreground/50"
                  />
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                </button>
                <span className="flex shrink-0 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <MenuRowIcon
                    icon={ArrowUp02Icon}
                    label="上移"
                    disabled={i === 0}
                    onClick={() => setLinks(moveQuickLink(l.id, -1))}
                  />
                  <MenuRowIcon
                    icon={ArrowDown02Icon}
                    label="下移"
                    disabled={i === custom.length - 1}
                    onClick={() => setLinks(moveQuickLink(l.id, 1))}
                  />
                  <MenuRowIcon
                    icon={PencilEdit02Icon}
                    label="编辑"
                    onClick={() => setEditing(l)}
                  />
                  <MenuRowIcon
                    icon={Delete02Icon}
                    label="删除"
                    destructive
                    onClick={() => setLinks(removeQuickLink(l.id))}
                  />
                </span>
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickLinkEditDialog
        link={editing}
        allowApp
        description="网址用浏览器打开;也可以收藏本机应用,点一下直接唤起来。"
        onClose={() => setEditing(null)}
        onSave={(l) => setLinks(upsertQuickLink(l))}
      />
    </>
  );
}
