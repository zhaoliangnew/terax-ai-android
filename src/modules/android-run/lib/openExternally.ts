import { native } from "@/modules/ai/lib/native";

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 用系统默认浏览器打开,不占工具自己的窗口。 */
export function openExternally(url: string): void {
  void native.shellBgSpawn(`open ${shellQuote(url)}`, null);
}
