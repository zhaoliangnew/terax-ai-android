import { Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { DingGroupPickerDialog } from "./DingGroupPickerDialog";
import {
  type ResolvedGroup,
  resolveGroupBinding,
  revealConversation,
} from "./lib/dingtalk";

type Props = {
  /** Gradle/Flutter project root of the active product. */
  projectRoot: string;
};

function parentOf(p: string): string {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i > 0 ? t.slice(0, i) : t;
}

/** 当前工程对应的钉钉对接群,一键跳转;没绑过就先选一个。 */
export function ProjectGroupButton({ projectRoot }: Props) {
  const [group, setGroup] = useState<ResolvedGroup | null>(null);
  // 没绑过时默认绑到产品线目录(工程的上一级),跟云效项目同一层级。
  const [pickerDir, setPickerDir] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setGroup(resolveGroupBinding(projectRoot));
  }, [projectRoot]);

  useEffect(refresh, [refresh]);

  return (
    <>
      <button
        type="button"
        title={
          group
            ? `${group.name} · 点击复制群名并切到钉钉(右键改绑)`
            : "还没关联钉钉群,点击选择"
        }
        onClick={() => {
          if (group) void revealConversation(group.name);
          else setPickerDir(parentOf(projectRoot));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setPickerDir(group?.dir ?? parentOf(projectRoot));
        }}
        className="flex max-w-40 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <HugeiconsIcon icon={Message01Icon} size={12} strokeWidth={1.75} />
        <span className="truncate">{group ? group.name : "关联群"}</span>
      </button>

      <DingGroupPickerDialog
        dir={pickerDir}
        onClose={() => setPickerDir(null)}
        onSaved={refresh}
      />
    </>
  );
}
