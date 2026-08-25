import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getCodeupOrgId, projexUrl } from "./lib/codeupApi";
import { openExternally } from "./lib/openExternally";
import { resolveProjectLink } from "./lib/yunxiao";

type Props = {
  /** 产品目录(面包屑倒数第二段对应的那个目录)。 */
  dir: string;
  /** 显示的名字(目录名)。 */
  label: string;
  /** 绑定关系变了要重算,靠这个 signal 触发重渲染。 */
  linkVersion?: number;
  /** 没绑过时点击:让外面弹选择器。 */
  onLink: (dir: string) => void;
  className?: string;
};

/**
 * 面包屑里的产品目录段:绑了云效项目点一下直达,没绑点一下去绑。
 *
 * 改绑/解绑放在目录树右键菜单里,这里不做双击 —— 浏览器双击会先发两次
 * click 再发 dblclick,想区分就得给单击加延迟,点一下要等一下才跳,很别扭。
 */
export function ProductLinkChip({
  dir,
  label,
  linkVersion = 0,
  onLink,
  className,
}: Props) {
  // 绑定关系存在 localStorage 里,读它是个副作用,不能在渲染期算:
  // React Compiler 按"回调里实际用到什么"推断依赖,useMemo 手写的
  // [dir, linkVersion] 会被它忽略,linkVersion 变了也不重算(解绑之后
  // 这里还当成绑着,照样跳转)。放进 effect 里才真的跟着信号走。
  const [resolved, setResolved] = useState(() => resolveProjectLink(dir));
  // biome-ignore lint/correctness/useExhaustiveDependencies: linkVersion 是绑定变更信号
  useEffect(() => {
    setResolved(resolveProjectLink(dir));
  }, [dir, linkVersion]);
  const orgId = getCodeupOrgId();

  return (
    <button
      type="button"
      title={
        resolved
          ? `云效项目:${resolved.link.name}(点击打开;改绑/解绑在目录右键菜单)`
          : "还没关联云效项目,点击关联"
      }
      onClick={() => {
        if (!resolved) {
          onLink(dir);
          return;
        }
        if (!orgId) {
          toast.error("请先在设置里配置云效组织 ID");
          return;
        }
        openExternally(projexUrl(orgId, resolved.link.id));
      }}
      className={cn(
        "cursor-pointer rounded px-1 transition-colors hover:bg-foreground/10",
        resolved ? "text-foreground/80" : "text-muted-foreground/80",
        className,
      )}
    >
      {label}
    </button>
  );
}
