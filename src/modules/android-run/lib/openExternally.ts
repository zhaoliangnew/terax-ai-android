import { IS_MAC } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { openUrl } from "@tauri-apps/plugin-opener";

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 先在 Chrome 里找有没有这个地址的标签页,找到就切过去(HIT),没有才 MISS。
 *
 * 用 argv 传地址而不是拼进脚本里 —— 脚本文本是死的,地址里有引号也炸不了。
 * 匹配只认全等(容忍末尾一个 /):同一个云效项目下的不同需求只差路径尾巴,
 * 模糊匹配会把人送到隔壁需求去,比多开一个 tab 烦多了。
 */
const FOCUS_TAB = `on run argv
set t to item 1 of argv
if application "Google Chrome" is not running then return "MISS"
tell application "Google Chrome"
repeat with w in windows
set i to 0
repeat with tb in tabs of w
set i to i + 1
set u to URL of tb as text
if u is t or u is (t & "/") or (u & "/") is t then
set active tab index of w to i
set index of w to 1
activate
return "HIT"
end if
end repeat
end repeat
end tell
return "MISS"
end run`;

/**
 * 用系统默认浏览器打开,不占工具自己的窗口。
 *
 * 已经开着的就切过去,只有没开过才新开一个 tab —— 底部那几个入口一天点几十次,
 * 每次都新开的话浏览器很快就一排重复标签。
 *
 * 只认 Chrome(本机默认浏览器)。Chrome 没开、脚本报错、或者用户拒了
 * "控制 Google Chrome" 的授权,都会落回 `open`,行为跟以前一样,不会打不开。
 */
/**
 * 同一个地址短时间内只开一次。
 *
 * 有人遇到过点一下弹出两个标签页。单独跑那条 shell 命令只会开一个(实测数过
 * 标签数),所以是上层被调了两次 —— 可能是双击,也可能是菜单项的事件走了两遍。
 * 与其猜,不如在这儿兜住:重复的那次直接丢掉,反正没人会在半秒内故意开同一个
 * 地址两次。
 */
const lastOpen = new Map<string, number>();

export function openExternally(url: string): void {
  const now = Date.now();
  if (now - (lastOpen.get(url) ?? 0) < 800) return;
  lastOpen.set(url, now);
  const u = shellQuote(url);
  if (!IS_MAC) {
    // 复用标签页那套是 AppleScript 写的,只有 macOS 有。别的平台交给系统默认
    // 浏览器 —— 功能在,只是少了"已开就切过去"。
    //
    // 走 opener 插件而不是拼 shell:Windows 那边 shell 可能是 cmd 也可能是
    // PowerShell,`start` 的写法和引号规则两边都不一样,拼字符串迟早出错。
    void openUrl(url);
    return;
  }
  void native.shellBgSpawn(
    `osascript -e ${shellQuote(FOCUS_TAB)} ${u} 2>/dev/null | grep -q HIT || open ${u}`,
    null,
  );
}
