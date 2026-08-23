import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { native } from "@/modules/ai/lib/native";
import { ArrowDown01Icon, CloudIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import {
  codeupPathFromRemote,
  codeupUrl,
  type ResolvedLink,
  resolveProjectLink,
} from "./lib/yunxiao";
import { YunxiaoLinkDialog } from "./YunxiaoLinkDialog";

type Props = {
  /** Gradle/Flutter project root of the active product. */
  projectRoot: string;
};

function parentOf(p: string): string {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i > 0 ? t.slice(0, i) : t;
}

export function openExternally(url: string): void {
  void native.shellBgSpawn(`open '${url.replace(/'/g, `'\\''`)}'`, null);
}

/** 云效直达:代码仓库地址从 git remote 自动推,项目地址按产品线目录继承。 */
export function YunxiaoMenu({ projectRoot }: Props) {
  const [codeupPath, setCodeupPath] = useState<string | null>(null);
  const [link, setLink] = useState<ResolvedLink | null>(null);
  // 没配过时默认绑到产品线目录(工程的上一级),那才是云效项目对应的层级。
  const [editingDir, setEditingDir] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLink(resolveProjectLink(projectRoot));
  }, [projectRoot]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void native
      .gitRemoteUrl(projectRoot)
      .catch(() => null)
      .then((remote) => {
        if (!cancelled) setCodeupPath(codeupPathFromRemote(remote));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot]);

  if (!codeupPath && !link) return null;

  const openProject = () => {
    if (link) openExternally(link.url);
    else setEditingDir(parentOf(projectRoot));
  };

  return (
    <>
      <span className="flex items-center">
        <button
          type="button"
          onClick={openProject}
          title={
            link ? `打开云效项目 · ${link.url}` : "还没关联云效项目,点击设置"
          }
          className="flex items-center gap-1 rounded-l border border-r-0 border-border px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={CloudIcon} size={12} strokeWidth={1.75} />
          云效
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="云效相关链接"
              className="flex items-center rounded-r border border-border px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="text-xs">云效</DropdownMenuLabel>
            <DropdownMenuItem className="text-xs" onSelect={openProject}>
              {link ? "打开项目(需求/任务)" : "关联云效项目…"}
            </DropdownMenuItem>
            {codeupPath && (
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => openExternally(codeupUrl(codeupPath))}
              >
                打开代码仓库
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => setEditingDir(link?.dir ?? parentOf(projectRoot))}
            >
              {link
                ? `修改关联(${link.dir.split("/").pop()})`
                : "设置关联目录…"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>

      <YunxiaoLinkDialog
        dir={editingDir}
        onClose={() => setEditingDir(null)}
        onSaved={refresh}
      />
    </>
  );
}
