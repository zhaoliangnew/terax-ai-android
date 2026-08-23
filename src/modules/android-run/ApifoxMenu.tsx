import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ApiIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Delete02Icon,
  ExternalLinkIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  APIFOX_HOME,
  isBuiltinApifoxLink,
  loadApifoxLinks,
  moveApifoxLink,
  removeApifoxLink,
  upsertApifoxLink,
} from "./lib/apifoxLinks";
import {
  MENU_ACTION,
  MENU_HEAD,
  MENU_ROW,
  MENU_TRIGGER,
} from "./lib/menuStyles";
import { openExternally } from "./lib/openExternally";
import { newLinkId, type QuickLink } from "./lib/quickLinks";
import { MenuRowIcon } from "./MenuRowIcon";
import { QuickLinkEditDialog } from "./QuickLinkEditDialog";

/**
 * Apifox 接口文档:常开的项目列在这儿,点一下用浏览器打开。
 *
 * 内置那两个项目跟着代码走(改不了删不了),自己要跟的项目往后面加。
 */
export function ApifoxMenu() {
  const [links, setLinks] = useState<QuickLink[]>(() => loadApifoxLinks());
  const [editing, setEditing] = useState<QuickLink | null>(null);

  const custom = links.filter((l) => !isBuiltinApifoxLink(l));

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setLinks(loadApifoxLinks());
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Apifox 接口文档"
            className={MENU_TRIGGER}
          >
            <HugeiconsIcon icon={ApiIcon} size={13} strokeWidth={1.75} />
            Apifox
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          collisionPadding={8}
          className="w-72 p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className={MENU_HEAD}>
            Apifox
            <span className="flex items-center gap-1">
              <button
                type="button"
                title="打开团队首页"
                onClick={() => openExternally(APIFOX_HOME)}
                className={MENU_ACTION}
              >
                <HugeiconsIcon
                  icon={ExternalLinkIcon}
                  size={12}
                  strokeWidth={1.75}
                />
                首页
              </button>
              <button
                type="button"
                title="添加项目"
                onClick={() =>
                  setEditing({ id: newLinkId(), title: "", url: "" })
                }
                className={MENU_ACTION}
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
                添加
              </button>
            </span>
          </div>
          <div className="max-h-[26rem] overflow-y-auto px-1.5 pb-2">
            {links.map((l) => {
              const builtin = isBuiltinApifoxLink(l);
              const i = custom.indexOf(l);
              return (
                <div key={l.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    title={l.url}
                    onClick={() => openExternally(l.url)}
                    className={MENU_ROW}
                  >
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                  </button>
                  {/* 内置项不给增删改的手柄,免得点错了名单就花了。 */}
                  {!builtin && (
                    <span className="flex shrink-0 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <MenuRowIcon
                        icon={ArrowUp02Icon}
                        label="上移"
                        disabled={i === 0}
                        onClick={() => setLinks(moveApifoxLink(l.id, -1))}
                      />
                      <MenuRowIcon
                        icon={ArrowDown02Icon}
                        label="下移"
                        disabled={i === custom.length - 1}
                        onClick={() => setLinks(moveApifoxLink(l.id, 1))}
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
                        onClick={() => setLinks(removeApifoxLink(l.id))}
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickLinkEditDialog
        link={editing}
        title="Apifox 项目"
        description="在 Apifox 里打开项目,把地址栏那串贴过来。"
        placeholder="https://app.apifox.com/project/…"
        onClose={() => setEditing(null)}
        onSave={(l) => setLinks(upsertApifoxLink(l))}
      />
    </>
  );
}
