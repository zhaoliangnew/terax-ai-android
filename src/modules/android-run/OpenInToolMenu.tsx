import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  detectTools,
  type ExternalTool,
  openFolder,
  openInTool,
} from "./lib/externalTools";
import { ANDROID_STUDIO_ICON, SOURCETREE_ICON } from "./lib/toolIcons";

type Props = {
  /** Project root to hand to the external app (it opens *at* this path). */
  projectRoot: string;
};

/** The two that get opened all day; anything else is a Finder trip away. */
const PINNED: Record<string, { iconUrl: string }> = {
  "android-studio": { iconUrl: ANDROID_STUDIO_ICON },
  sourcetree: { iconUrl: SOURCETREE_ICON },
};

const ICON_BUTTON =
  "flex size-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors";

/** "在外部打开" — hands the current project root to Android Studio / Sourcetree
 * / IDEA etc., so they open and focus this project rather than just launching. */
export function OpenInToolMenu({ projectRoot }: Props) {
  const [tools, setTools] = useState<{ tool: ExternalTool; appPath: string }[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void detectTools().then((found) => {
      if (!cancelled) setTools(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 只留常驻的几个;IntelliJ/Cursor 这类顺手在访达里打开就行,不值当再挂个下拉。
  const pinned = tools.filter(({ tool }) => tool.id in PINNED);

  return (
    <span className="flex items-center gap-1">
      {pinned.map(({ tool, appPath }) => (
        <button
          key={tool.id}
          type="button"
          aria-label={tool.name}
          title={`在 ${tool.name} 中打开这个项目`}
          onClick={() => void openInTool(appPath, projectRoot)}
          className="flex size-6 items-center justify-center rounded transition-colors hover:bg-accent"
        >
          {/* No border box around these: the vendor marks are solid light/blue
              tiles, and framing them made them read as白方块 pasted onto the
              dark bar. Dimmed at rest so they don't outshine the outline icons
              next to them. */}
          <img
            src={PINNED[tool.id].iconUrl}
            alt=""
            className="size-[15px] shrink-0 rounded-[3px] opacity-75 transition-opacity hover:opacity-100"
          />
        </button>
      ))}
      <button
        type="button"
        aria-label="在访达中打开"
        title="在访达中打开这个目录"
        onClick={() => void openFolder(projectRoot)}
        className={`${ICON_BUTTON} hover:border-foreground/40 hover:text-foreground`}
      >
        <HugeiconsIcon icon={Folder01Icon} size={13} strokeWidth={1.75} />
      </button>
    </span>
  );
}
