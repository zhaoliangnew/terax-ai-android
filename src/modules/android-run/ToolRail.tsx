import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import { ApifoxMenu } from "./ApifoxMenu";
import { CustomLinksMenu } from "./CustomLinksMenu";
import { DingGroupsMenu } from "./DingGroupsMenu";
import { JournalButton } from "./JournalButton";
import { KnowledgeBaseMenu } from "./KnowledgeBaseMenu";
import { TestEnvMenu } from "./TestEnvMenu";
import { WeChatButton } from "./WeChatButton";
import { YunxiaoProjectsButton } from "./YunxiaoProjectsButton";
import { YunxiaoReposButton } from "./YunxiaoReposButton";

/** 短文字标识保留窄栏宽度,悬停显示完整工具名称。 */
function RailTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span className="flex">{children}</span>
      </TooltipTrigger>
      {/* 照 Codex:深色小圆角标签,贴着图标右边,不要默认那种大号浅色气泡 */}
      <TooltipContent
        side="right"
        sideOffset={4}
        className="rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-popover-foreground shadow-md"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolRail({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <nav
      aria-label="工具"
      className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-2 py-2"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto">
        <RailTip label="嵌入式组知识库">
          <KnowledgeBaseMenu />
        </RailTip>
        <RailTip label="云效项目">
          <YunxiaoProjectsButton />
        </RailTip>
        <RailTip label="云效代码库">
          <YunxiaoReposButton />
        </RailTip>
        <RailTip label="Apifox 接口文档">
          <ApifoxMenu />
        </RailTip>
        <RailTip label="测试环境">
          <TestEnvMenu />
        </RailTip>
        <RailTip label="记一下">
          <JournalButton />
        </RailTip>
        <RailTip label="钉钉直达">
          <DingGroupsMenu />
        </RailTip>
        <RailTip label="微信">
          <WeChatButton />
        </RailTip>
        <RailTip label="收藏夹">
          <CustomLinksMenu />
        </RailTip>
      </div>
      <RailTip label="设置">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="设置"
          onClick={onOpenSettings}
          className="size-9 shrink-0 rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden="true">设置</span>
        </Button>
      </RailTip>
    </nav>
  );
}
