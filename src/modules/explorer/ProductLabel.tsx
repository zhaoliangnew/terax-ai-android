import { cn } from "@/lib/utils";
import { useProductAlias } from "./lib/productAliases";

/**
 * 产品名:有中文名就"取盘机 app_bind"(中文在前、英文小一号灰字跟后面),
 * 没有就只写英文名。颜色、粗细跟着外面那层走,英文名只是再淡一点。
 */
export function ProductLabel({
  name,
  subClassName,
  stacked = false,
}: {
  name: string;
  /** 分两行:中文一行,英文名在下面一行。 */
  stacked?: boolean;
  /** 英文名那一截的样式(默认小一号、半透明)。 */
  subClassName?: string;
}) {
  const alias = useProductAlias(name);
  if (!alias) return <>{name}</>;
  if (stacked)
    return (
      <span className="flex flex-col leading-tight">
        <span>{alias}</span>
        <span
          className={cn("text-[11px] font-normal opacity-60", subClassName)}
        >
          {name}
        </span>
      </span>
    );
  return (
    <>
      {alias}
      <span
        className={cn(
          "ml-1.5 text-[0.88em] font-normal opacity-60",
          subClassName,
        )}
      >
        {name}
      </span>
    </>
  );
}
