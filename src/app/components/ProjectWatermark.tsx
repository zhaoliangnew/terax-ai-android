import { useProjectBranch } from "@/modules/android-run/BranchChip";

/**
 * 按"这行字有多宽"算字号:目标宽度(容器的 widthCqw%) ÷ 字符宽度
 * 单位数。CJK 按 1.05 个字号宽算,ASCII 按 0.65,字间距逐字累加。
 * 这样不管名字多长都刚好占满目标宽度,永远不会截断出省略号;
 * 三行给不同的目标宽度,拉开主次。
 */
function fitFont(
  text: string,
  trackingEm: number,
  widthCqw: number,
  capPx: number,
): string {
  const units = Array.from(text).reduce(
    (n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xff ? 1.05 : 0.65) + trackingEm,
    0,
  );
  return `min(${capPx}px, ${(widthCqw / Math.max(units, 1)).toFixed(2)}cqw)`;
}

/** 终端空白处的水印:产品名 / 工程名 / 分支名,纯装饰。 */
export function ProjectWatermark({ projectRoot }: { projectRoot: string }) {
  const branch = useProjectBranch(projectRoot);
  const product = projectRoot.split("/").slice(-2, -1)[0] ?? "";
  const project = projectRoot.split("/").slice(-1)[0] ?? "";
  return (
    <div
      aria-hidden
      className="@container pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center gap-2 px-6 opacity-[0.12]"
    >
      <span
        className="max-w-full whitespace-nowrap leading-none tracking-[0.18em]"
        style={{ fontSize: fitFont(product, 0.18, 58, 48) }}
      >
        {product}
      </span>
      <span
        className="max-w-full whitespace-nowrap font-bold leading-none tracking-[0.06em]"
        style={{ fontSize: fitFont(project, 0.06, 90, 104) }}
      >
        {project}
      </span>
      {branch && (
        <span
          className="max-w-full whitespace-nowrap leading-none tracking-[0.2em]"
          style={{ fontSize: fitFont(branch, 0.2, 64, 54) }}
        >
          {branch}
        </span>
      )}
    </div>
  );
}
