import { Notebook01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { JournalDialog } from "./JournalDialog";
import { MENU_TRIGGER } from "./lib/menuStyles";

/** 日报入口。按钮上写"记一下"—— 大多数时候点它是为了记,不是为了看报表。 */
export function JournalButton() {
  const [open, setOpen] = useState(false);
  return (
    <JournalDialog
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          type="button"
          title="记一下 · 随手记一条,写日报/周报时一键复制"
          onClick={() => setOpen((v) => !v)}
          className={MENU_TRIGGER}
        >
          <HugeiconsIcon icon={Notebook01Icon} size={13} strokeWidth={1.75} />
          记一下
        </button>
      }
    />
  );
}
