import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  Bookmark02Icon,
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  Link02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { MENU_ACTION, MENU_HEAD, MENU_TRIGGER } from "./lib/menuStyles";
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
      {/* 贴着底栏往上弹,跟测试环境/钉钉直达一个样式 —— 居中大弹窗配上
          两三条收藏,全屏遮罩顶着一小块内容,看着很怪。内容多了往上长,
          到上限内部滚动。 */}
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="收藏夹"
            onClick={() => setLinks(loadQuickLinks())}
            className={MENU_TRIGGER}
          >
            <HugeiconsIcon icon={Bookmark02Icon} size={13} strokeWidth={1.75} />
            收藏夹
          </button>
        </PopoverTrigger>
        <PopoverContent
          backdrop
          side="top"
          align="start"
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // 编辑收藏是个套在里面的 Dialog,渲染在 portal 里,点它会被当成
          // "点了外面"把浮层关掉 —— 编辑期间不让关
          onInteractOutside={(e) => {
            if (editing !== null) e.preventDefault();
          }}
          // 高度固定而不是跟着内容走:收藏少的时候一条贴一条也显小气,
          // 固定一块稳定的面积,内容多了内部滚动。
          className="flex h-[30rem] max-h-[calc(100vh-5rem)] w-[38rem] max-w-[calc(100vw-2rem)] flex-col p-0"
        >
          <div className={MENU_HEAD}>
            <span className="flex items-center gap-3">
              收藏夹
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
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {custom.length === 0 && (
              <div className="px-3 py-8 text-center text-[12.5px] text-muted-foreground/50">
                还没有收藏 —— 点上面「添加」收个应用或网页
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
                        // 跳过去就顺手关掉:打开收藏就是为了去那儿,浮层留着反而挡事
                        onClick={() => {
                          openQuickLink(l);
                          setOpen(false);
                        }}
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
                {/* 原来是一行一条的窄列表,标题稍微长一点(比如带部门名的对接
                    协议)就被截断,只能悬停看 title 提示。改成跟应用一样的卡片:
                    两列,标题允许换到两行,地址单独一行放在下面,不用猜就能
                    看全。 */}
                <div className="grid grid-cols-2 gap-1.5 px-2">
                  {sites.map((l, i) => (
                    <div
                      key={l.id}
                      className="group relative flex flex-col gap-1 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-ring/60 hover:bg-accent/40"
                    >
                      <button
                        type="button"
                        title={l.url}
                        onClick={() => {
                          openQuickLink(l);
                          setOpen(false);
                        }}
                        className="flex min-w-0 items-start gap-1.5 text-left"
                      >
                        <HugeiconsIcon
                          icon={Link02Icon}
                          size={13}
                          strokeWidth={1.75}
                          className="mt-0.5 shrink-0 text-muted-foreground/50"
                        />
                        <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug">
                          {l.title}
                        </span>
                      </button>
                      <span className="truncate pl-[1.125rem] font-mono text-[11px] text-muted-foreground/50">
                        {l.url}
                      </span>
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded bg-background/85 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100">
                        <MenuRowIcon
                          icon={Copy01Icon}
                          label="复制链接"
                          onClick={() => {
                            void copyToClipboard(l.url);
                            toast.success("已复制链接", {
                              description: l.title,
                            });
                          }}
                        />
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
        </PopoverContent>
      </Popover>

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
