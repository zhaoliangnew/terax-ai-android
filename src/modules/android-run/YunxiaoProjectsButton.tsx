import { CheckListIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { RAIL_TRIGGER } from "./lib/menuStyles";
import { ProjexDialog } from "./ProjexDialog";

/** 云效项目:从底栏往上弹一个浮层,左边项目、右边需求/任务列表。 */
export function YunxiaoProjectsButton() {
  const [open, setOpen] = useState(false);

  return (
    <ProjexDialog
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={RAIL_TRIGGER}
          aria-label="云效项目"
        >
          <HugeiconsIcon icon={CheckListIcon} size={18} strokeWidth={1.6} />
        </button>
      }
    />
  );
}
