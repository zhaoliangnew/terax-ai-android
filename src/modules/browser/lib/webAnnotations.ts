/** 网页批注里的一条:点中的元素 + 用户写的评论(Rust 转过来的原样)。 */
export type WebAnnotItem = {
  tag: string;
  text: string;
  selector: string;
  note: string;
};

export type WebAnnotReport = {
  label: string;
  /** "sync" = 列表变了;"send" = 页面里点了发送/⌘⏎;"exit" = 点了 ✕。 */
  kind: "sync" | "send" | "exit";
  url: string;
  title: string;
  items: WebAnnotItem[];
};

/** 元素的一句话描述:`<button>「提交」`,没文字就只有标签。 */
export function describeElement(it: WebAnnotItem): string {
  const tag = `<${it.tag || "?"}>`;
  return it.text ? `${tag}「${it.text}」` : tag;
}

/** 发给模型的整段文字:哪个页面、每处是哪个元素(带选择器好定位代码)、评论。 */
export function annotationPrompt(report: {
  url: string;
  title: string;
  items: WebAnnotItem[];
}): string {
  const page = report.title ? `「${report.title}」(${report.url})` : report.url;
  const lines = report.items.map((it, i) => {
    const where = it.selector ? `,选择器 ${it.selector}` : "";
    return `${i + 1}. ${describeElement(it)}${where}:${it.note}`;
  });
  return `这是内嵌浏览器里 ${page} 页面上的 ${report.items.length} 处批注:\n${lines.join("\n")}`;
}

/** 输入框上方"N 条注释"卡片里每条显示的字。 */
export function annotationCards(items: WebAnnotItem[]) {
  return items.map((it) => ({
    thumb: "",
    note: `${describeElement(it)} ${it.note}`,
  }));
}
