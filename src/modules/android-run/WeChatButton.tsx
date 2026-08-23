import { IS_MAC } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { findApp, openApp } from "./lib/apps";
import { MENU_TRIGGER } from "./lib/menuStyles";

/**
 * 微信只是切过去,不做别的。
 *
 * 跟钉钉那边一样,直接进某个会话是做不到的(见 dingtalk.ts 里那段);微信连
 * "复制群名再搜"这条路都没有 —— 它连个能用的 URL scheme 都不给。所以就是
 * 把它唤到前台,省掉去 Dock/任务栏里找。
 */
async function openWeChat(): Promise<void> {
  if (IS_MAC) {
    void native.shellBgSpawn("open -a WeChat", null);
    return;
  }
  // Windows/Linux 装出来的名字不一定叫什么,中英文都试一遍
  const app = await findApp(["微信", "WeChat", "weixin"]);
  if (app) {
    openApp(app.path);
    return;
  }
  toast.error("没找到微信", {
    description: "可以在收藏夹里手动添加一个应用入口",
  });
}

export function WeChatButton() {
  return (
    <button
      type="button"
      title="打开微信"
      onClick={() => void openWeChat()}
      className={MENU_TRIGGER}
    >
      <HugeiconsIcon icon={BubbleChatIcon} size={13} strokeWidth={1.75} />
      微信
    </button>
  );
}
