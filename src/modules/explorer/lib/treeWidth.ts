/** 每一层缩进多少:12px 时子行名字几乎和父行对齐,层级看不出来。 */
export const TREE_INDENT = 18;

/** 行里名字以外占的宽度:左留白 6 + 图标 16 + 间距 8,右边给未保存点/图钉/云图标留 30。 */
const ROW_CHROME = 6 + 16 + 8 + 30;

/**
 * 文件树内容要多宽才能把最长的那行名字显示全(侧栏比这窄就横向滚动)。
 * 树是虚拟列表、行是绝对定位的,撑不开容器,只能算出来。
 */
export function treeContentWidth(
  rows: readonly { depth: number; name?: string }[],
  measure: (text: string) => number,
): number {
  let max = 0;
  for (const r of rows) {
    if (r.name === undefined) continue;
    const w = r.depth * TREE_INDENT + ROW_CHROME + measure(r.name);
    if (w > max) max = w;
  }
  return Math.ceil(max);
}

let ctx: CanvasRenderingContext2D | null = null;

/** 按文件树行的字体(13px 界面字体)量一段文字的宽度。 */
export function measureTreeText(text: string): number {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = `13px ${getComputedStyle(document.body).fontFamily}`;
  return ctx.measureText(text).width;
}
