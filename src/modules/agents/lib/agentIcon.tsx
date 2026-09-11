import {
  AiBrowserIcon,
  ChatGptIcon,
  ClaudeIcon,
  CodeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

// Pi mark, from github.com/earendil-works pi-website logo.svg (MIT).
function PiIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

// Qoder 的标记不是一段 path:它是装好的 app 图标里那个字形
// (`Qoder CN.app/Contents/Resources/application-icons/qoder-dark.png`)——
// 白字形当 alpha、黑底片掉,再裁到字形本身。用 mask-image 涂上去,它就跟旁边
// 那几个描边图标一样吃 currentColor;直接 <img> 原图的话,深色工具栏上贴的是
// 一个黑方块。alpha 还做了一次 gamma 0.5 提亮:这个标是细描边,原样贴进来比
// 旁边那两个实心标明显浅一档。Qoder 改标之后重新导一次即可。
const QODER_MASK =
  "data:image/png;base64,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";

export function QoderMark({
  size = 15,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url("${QODER_MASK}")`,
        maskImage: `url("${QODER_MASK}")`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

function iconFor(agent: string): IconSvgElement {
  const a = agent.toLowerCase();
  if (a.includes("claude")) return ClaudeIcon;
  if (a.includes("gemini")) return GoogleGeminiIcon;
  if (a.includes("opencode")) return CodeIcon;
  if (a.includes("grok")) return Grok02Icon;
  if (a.includes("codex") || a.includes("gpt") || a.includes("openai"))
    return ChatGptIcon;
  return AiBrowserIcon;
}

export function AgentIcon({
  agent,
  size = 15,
  className,
}: {
  agent: string;
  size?: number;
  className?: string;
}) {
  if (agent.toLowerCase() === "pi") {
    return <PiIcon size={size} className={className} />;
  }
  if (agent.toLowerCase().includes("qoder")) {
    return <QoderMark size={size} className={className} />;
  }
  if (agent.toLowerCase().includes("terax")) {
    return (
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={iconFor(agent)}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
