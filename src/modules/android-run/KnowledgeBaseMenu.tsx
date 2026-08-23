import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  BookOpen01Icon,
  ExternalLinkIcon,
  File01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { KNOWLEDGE_BASE_HOME } from "./lib/knowledgeBase";
import {
  MENU_ACTION,
  MENU_HEAD,
  MENU_ROW,
  MENU_TRIGGER,
} from "./lib/menuStyles";
import { openExternally } from "./lib/openExternally";
import { loadQuickLinks } from "./lib/quickLinks";

/**
 * 嵌入式组知识库的一级目录,内容写死在 knowledgeBase.ts 里跟着知识库走,
 * 这里只负责列出来点开。
 */
export function KnowledgeBaseMenu() {
  const items = loadQuickLinks().filter((l) => l.kind);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="嵌入式组知识库" className={MENU_TRIGGER}>
          <HugeiconsIcon icon={BookOpen01Icon} size={13} strokeWidth={1.75} />
          嵌入式组知识库
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
          嵌入式组知识库
          <button
            type="button"
            title="打开知识库首页"
            onClick={() => openExternally(KNOWLEDGE_BASE_HOME)}
            className={MENU_ACTION}
          >
            <HugeiconsIcon
              icon={ExternalLinkIcon}
              size={12}
              strokeWidth={1.75}
            />
            首页
          </button>
        </div>
        {/* 一栏到底。菜单往上顶到窗口边,20 条正好铺开,不换行也不滚。 */}
        <div className="flex flex-col px-1.5 pb-2">
          {items.map((l, i) => (
            <button
              key={l.id}
              type="button"
              title={l.url}
              onClick={() => openExternally(l.url)}
              className={MENU_ROW}
            >
              <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground/50 tabular-nums">
                {i + 1}
              </span>
              <HugeiconsIcon
                icon={l.kind === "doc" ? File01Icon : Folder01Icon}
                size={13}
                strokeWidth={1.75}
                className="shrink-0 text-muted-foreground/60"
              />
              {/* 目录名不截断:菜单宽度跟着内容走。 */}
              <span className="whitespace-nowrap">{l.title}</span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
