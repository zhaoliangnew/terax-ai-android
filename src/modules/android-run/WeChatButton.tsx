import { native } from "@/modules/ai/lib/native";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MENU_TRIGGER } from "./lib/menuStyles";

/**
 * 微信只是切过去,不做别的。
 *
 * 跟钉钉那边一样,直接进某个会话是做不到的(见 dingtalk.ts 里那段);微信连
 * "复制群名再搜"这条路都没有 —— 它连个能用的 URL scheme 都不给。所以就是
 * 把它唤到前台,省掉去 Dock 里找。
 */
const OPEN_WECHAT = `open -a WeChat`;

export function WeChatButton() {
  return (
    <button
      type="button"
      title="打开微信"
      onClick={() => void native.shellBgSpawn(OPEN_WECHAT, null)}
      className={MENU_TRIGGER}
    >
      <HugeiconsIcon icon={BubbleChatIcon} size={13} strokeWidth={1.75} />
      微信
    </button>
  );
}
