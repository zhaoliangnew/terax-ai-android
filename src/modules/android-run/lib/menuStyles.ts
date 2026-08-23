/**
 * 底部三个快捷菜单(嵌入式组知识库 / 收藏夹 / 钉钉直达)共用的样式。
 * 抽出来是为了三个菜单尺寸一致 —— 这些是天天要点的东西,行高和字号都给足,
 * 别让人凑近了瞄准。
 */

/** 底栏上的触发按钮。 */
export const MENU_TRIGGER =
  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/** 下拉里的标题行。 */
export const MENU_HEAD =
  "flex items-center justify-between gap-3 px-3 py-2 text-[12.5px] font-semibold";

/** 标题行右侧的小动作(添加 / 首页)。 */
export const MENU_ACTION =
  "flex items-center gap-1 rounded px-1.5 py-1 text-[12px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground";

/** 可点的条目行。 */
export const MENU_ROW =
  "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-accent";

/** 空列表提示。 */
export const MENU_EMPTY = "px-2.5 py-2 text-[12px] text-muted-foreground/60";

/** 底部说明文字。 */
export const MENU_NOTE =
  "border-t border-border/60 px-3 py-2 text-[11px] leading-snug text-muted-foreground/60";
