import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { useAndroidRunStore } from "@/modules/android-run";
import { LspStatusPill } from "@/modules/lsp";
import type { WorkspaceEnv } from "@/modules/workspace";
import { IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Opens the panel, or Settings > Models when no API key is loaded. */
  onOpenAi: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  privateActive: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  onOpenAi,
  hasComposer,
  privateActive,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);

  const androidProjectRoot = useAndroidRunStore((s) => s.projectRoot);
  const androidCrumb = androidProjectRoot
    ? {
        project: androidProjectRoot.split("/").slice(-2, -1)[0] ?? "",
        product: androidProjectRoot.split("/").slice(-1)[0] ?? "",
      }
    : null;

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 pl-3 pr-4 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        {androidCrumb && (
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            <span>{androidCrumb.project}</span>
            <span className="opacity-60">/</span>
            <span className="font-medium text-emerald-500">
              {androidCrumb.product}
            </span>
            <span className="mx-1 h-3 w-px bg-border" />
          </span>
        )}
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        <LspStatusPill filePath={filePath ?? null} />
        <DiagnosticsBadge filePath={filePath ?? null} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AgentStatusPill onClick={onOpenMini} />
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={onOpenAi} />
        )}
      </div>
    </footer>
  );
}
