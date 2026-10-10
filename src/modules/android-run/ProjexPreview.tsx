import { WebTab } from "@/modules/browser/WebTab";
import { openInBrowser } from "@/modules/browser/webTabsStore";
import {
  Cancel01Icon,
  LinkSquare01Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { openExternally } from "./lib/openExternally";

/**
 * 云效浮层里直接看网页(工作项、视图、项目页):和右栏内置浏览器同一套原生
 * webview,登录态共用,不用跳系统浏览器。放在列表右边,列表照常能点。
 */
export function ProjexPreview({
  title,
  url,
  onBack,
}: {
  title: string;
  url: string;
  onBack: () => void;
}) {
  // 每次打开一个新 label:换地址时旧的 webview 还在异步关,复用同名 label
  // 会和它撞上
  const [tabId] = useState(
    () => `web-projex-${Math.random().toString(36).slice(2, 10)}`,
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-popover">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        <button
          type="button"
          title="关闭预览(Esc)"
          onClick={onBack}
          className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          关闭
        </button>
        <span
          title={title}
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium"
        >
          {title}
        </span>
        <button
          type="button"
          title="放到右栏内置浏览器里开着,方便边看边干活"
          onClick={() => {
            openInBrowser(url);
            onBack();
          }}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarRightIcon} size={13} strokeWidth={1.75} />
          在右栏打开
        </button>
        <button
          type="button"
          title="用系统浏览器打开"
          onClick={() => openExternally(url)}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <HugeiconsIcon icon={LinkSquare01Icon} size={13} strokeWidth={1.75} />
          系统浏览器
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <WebTab tabId={tabId} initialUrl={url} visible />
      </div>
    </div>
  );
}
