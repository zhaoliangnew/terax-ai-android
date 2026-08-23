import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
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
import { MENU_ACTION, MENU_ROW, MENU_TRIGGER } from "./lib/menuStyles";
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

const SECTION =
  "px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground/60";

/**
 * 自己攒的入口。应用和网页分两块:应用铺成方块(名字短,一眼扫过去),网页排成
 * 列表(标题长,一行一条才读得下)—— 两种东西的形状本来就不一样。
 */
export function CustomLinksMenu() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<QuickLink[]>(() => loadQuickLinks());
  const [editing, setEditing] = useState<QuickLink | null>(null);

  const custom = links.filter((l) => !l.kind);
  const apps = custom.filter((l) => l.target === "app");
  const sites = custom.filter((l) => l.target !== "app");

  const add = () => setEditing({ id: newLinkId(), title: "", url: "" });

  return (
    <>
      <button
        type="button"
        title="收藏夹"
        onClick={() => {
          setLinks(loadQuickLinks());
          setOpen(true);
        }}
        className={MENU_TRIGGER}
      >
        <HugeiconsIcon icon={Bookmark02Icon} size={13} strokeWidth={1.75} />
        收藏夹
      </button>

      {/* 居中弹窗而不是贴着底栏的下拉:收藏会越攒越多,四列方块加一串网页,
          挂在角落里既压着终端又只能长这么高。 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[70vh] flex-col gap-0 p-0 sm:max-w-2xl">
          {/* "添加"跟在标题后面,右上角整片留给关闭按钮 —— 它是绝对定位的
              (top-4 right-4),挤在同一行右端必然对不齐。 */}
          <DialogHeader className="flex-row items-center gap-3 space-y-0 border-b border-border px-4 py-3 pr-14">
            <DialogTitle className="text-[14px] font-semibold">
              收藏夹
            </DialogTitle>
            {/* 一个入口就够 —— 弹窗里第一行就是"网址/应用"的开关,
                在这儿再分一次是重复。 */}
            <button
              type="button"
              title="添加收藏"
              onClick={() => add()}
              className={MENU_ACTION}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
              添加
            </button>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {custom.length === 0 && (
              <div className="px-3 py-8 text-center text-[12.5px] text-muted-foreground/50">
                还没有收藏 —— 右上角加个应用或网页
              </div>
            )}

            {apps.length > 0 && (
              <>
                <div className={SECTION}>应用</div>
                <div className="grid grid-cols-4 gap-1.5 px-2">
                  {apps.map((l, i) => (
                    <div key={l.id} className="group relative">
                      <button
                        type="button"
                        title={`打开 ${l.url}`}
                        onClick={() => openQuickLink(l)}
                        className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-border/50 px-2 py-2.5 transition-colors hover:border-ring/60 hover:bg-accent"
                      >
                        <HugeiconsIcon
                          icon={ComputerIcon}
                          size={20}
                          strokeWidth={1.5}
                          className="text-muted-foreground/70"
                        />
                        <span className="w-full truncate text-center text-[12px]">
                          {l.title}
                        </span>
                      </button>
                      <span className="absolute top-0.5 right-0.5 flex items-center gap-0.5 rounded bg-background/85 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
                        <MenuRowIcon
                          icon={ArrowUp02Icon}
                          label="前移"
                          disabled={i === 0}
                          onClick={() => setLinks(moveQuickLink(l.id, -1))}
                        />
                        <MenuRowIcon
                          icon={ArrowDown02Icon}
                          label="后移"
                          disabled={i === apps.length - 1}
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
              </>
            )}

            {sites.length > 0 && (
              <>
                <div className={cn(SECTION, apps.length > 0 && "mt-1")}>
                  网页
                </div>
                <div className="px-2">
                  {sites.map((l, i) => (
                    <div key={l.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        title={l.url}
                        onClick={() => openQuickLink(l)}
                        className={MENU_ROW}
                      >
                        <HugeiconsIcon
                          icon={Link02Icon}
                          size={13}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground/50"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {l.title}
                        </span>
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
                          disabled={i === sites.length - 1}
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
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
