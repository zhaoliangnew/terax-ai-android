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

/**
 * 窗口最左边的工具竖条(照 Codex 的样子):以前摆在底栏的那排工具入口,
 * 只放图标,点开还是原来的下拉/浮层,改成往右弹。钉钉和微信挨着,都是聊天。
 */
/** 竖条上只有图标,悬停立刻在右边显示中文名,不然认不出哪个是哪个。 */
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

export function ToolRail() {
  return (
    <nav
      aria-label="工具"
      className="flex w-12 shrink-0 flex-col items-center gap-2 py-2"
    >
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
    </nav>
  );
}
