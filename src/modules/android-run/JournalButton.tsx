import { Notebook01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { JournalDialog } from "./JournalDialog";
import { RAIL_TRIGGER } from "./lib/menuStyles";

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
          onClick={() => setOpen((v) => !v)}
          className={RAIL_TRIGGER}
          aria-label="记一下"
        >
          <HugeiconsIcon icon={Notebook01Icon} size={18} strokeWidth={1.6} />
        </button>
      }
    />
  );
}
