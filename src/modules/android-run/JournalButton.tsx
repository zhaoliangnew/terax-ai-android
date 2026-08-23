import { Notebook01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { JournalDialog } from "./JournalDialog";
import { MENU_TRIGGER } from "./lib/menuStyles";

/** 日报入口:点开就能记一条。 */
export function JournalButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="日报 · 随手记一条,写日报/周报时一键复制"
        onClick={() => setOpen(true)}
        className={MENU_TRIGGER}
      >
        <HugeiconsIcon icon={Notebook01Icon} size={13} strokeWidth={1.75} />
        日报
      </button>
      <JournalDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
