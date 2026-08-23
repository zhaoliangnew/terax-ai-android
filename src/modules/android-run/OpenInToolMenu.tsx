import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowDown01Icon,
  ExternalLinkIcon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
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

/** The everyday two — worth a permanent button instead of a menu trip. The
 * rest stay in the dropdown so the bar doesn't turn into a toolbar zoo. */
const PINNED: Record<string, { iconUrl: string }> = {
  "android-studio": { iconUrl: ANDROID_STUDIO_ICON },
  sourcetree: { iconUrl: SOURCETREE_ICON },
};

const ICON_BUTTON =
  "flex size-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors";

/** "在外部打开" — hands the current project root to Android Studio / Sourcetree
 * / IDEA etc., so they open and focus this project rather than just launching. */
export function OpenInToolMenu({ projectRoot }: Props) {
  const [tools, setTools] = useState<
    { tool: ExternalTool; appPath: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void detectTools().then((found) => {
      if (!cancelled) setTools(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pinned = tools.filter(({ tool }) => tool.id in PINNED);
  const rest = tools.filter(({ tool }) => !(tool.id in PINNED));

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

      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="在其他外部工具中打开"
              className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ExternalLinkIcon}
                size={12}
                strokeWidth={1.75}
              />
              打开
              <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuLabel className="text-xs">
              在外部打开
            </DropdownMenuLabel>
            {rest.map(({ tool, appPath }) => (
              <DropdownMenuItem
                key={tool.id}
                className="text-xs"
                onSelect={() => void openInTool(appPath, projectRoot)}
              >
                {tool.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}
