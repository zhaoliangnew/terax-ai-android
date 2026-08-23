import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import { GitBranchIcon, Task01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { MENU_TRIGGER } from "./lib/menuStyles";
import { openExternally } from "./lib/openExternally";
import {
  codeupPathFromRemote,
  codeupUrl,
  getTaskLink,
  setTaskLink,
} from "./lib/yunxiao";
import { UrlPromptDialog } from "./UrlPromptDialog";

type Props = {
  /** Gradle/Flutter project root of the active product. */
  projectRoot: string;
  /** 变一下就重读存储 —— 目录树右键那边也能改同一份数据。 */
  version?: number;
  /** 这里改完通知外面,让右键菜单的文案跟着变。 */
  onChanged?: () => void;
};

/**
 * 工程相关的几个外部地址,一个按钮一个去处,点了就走 —— 不套二级菜单,
 * 这些是每天点很多次的东西。
 *
 *  - 当前云效需求:跟着**工程**走,手头这条需求,换需求就改
 *  - 代码仓库:从 git remote 推出来的,不用配
 *
 * 没配过的不显示,免得摆一排"还没关联"的空按钮。
 */
export function ProjectLinksBar({ projectRoot, version, onChanged }: Props) {
  const [codeupPath, setCodeupPath] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);

  const [taskDraft, setTaskDraft] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setTask(getTaskLink(projectRoot));
    // version 只是个改动信号,不参与计算,但要让 effect 重跑
  }, [projectRoot, version]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void native
      .gitRemoteUrl(projectRoot)
      .catch(() => null)
      .then((remote) => {
        if (!cancelled) setCodeupPath(codeupPathFromRemote(remote));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  return (
    <>
      {/* 需求地址常换,所以没配也显示,点一下就能填 */}
      <button
        type="button"
        title={
          task
            ? `当前云效需求 · ${task}(右键改)`
            : "还没填当前需求地址,点击填写"
        }
        onClick={() => (task ? openExternally(task) : setTaskDraft(""))}
        onContextMenu={(e) => {
          e.preventDefault();
          setTaskDraft(task ?? "");
        }}
        // 没填过的压暗一档:一眼看出这个按钮点了是"去填",不是"去打开"。
        className={cn(MENU_TRIGGER, !task && "text-muted-foreground/45")}
      >
        <HugeiconsIcon icon={Task01Icon} size={13} strokeWidth={1.75} />
        {/* 换成上下两行之后还是塞不下才丢文案(两条加起来快 200px),
            这时候按钮已经独占一行,面包屑不受影响。 */}
        <span className="@max-[400px]:hidden">当前云效需求</span>
      </button>

      {codeupPath && (
        <button
          type="button"
          title={`打开云效仓库 · ${codeupPath}`}
          onClick={() => openExternally(codeupUrl(codeupPath))}
          className={MENU_TRIGGER}
        >
          <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.75} />
          <span className="@max-[400px]:hidden">云效仓库</span>
        </button>
      )}

      <UrlPromptDialog
        value={taskDraft}
        title="当前云效需求"
        description={`贴上手头这条需求/任务的云效地址。只对 ${projectRoot.split("/").pop()} 生效,换需求随时改。`}
        onClose={() => setTaskDraft(null)}
        onSave={(url) => {
          setTaskLink(projectRoot, url);
          refresh();
          onChanged?.();
        }}
      />
    </>
  );
}
