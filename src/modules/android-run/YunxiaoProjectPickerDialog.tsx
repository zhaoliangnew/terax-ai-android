import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getCodeupOrgId,
  getYunxiaoToken,
  listProjects,
  type YunxiaoProject,
} from "./lib/codeupApi";
import type { LinkedProject } from "./lib/yunxiao";

type Props = {
  /** 要绑定的目录;null = 关闭。 */
  dir: string | null;
  /** 已经绑过的项目,用来在标题里提示当前绑的是哪个。 */
  current?: LinkedProject | null;
  onClose: () => void;
  onPick: (link: LinkedProject) => void;
};

/**
 * 选一个云效项目绑到目录上。组织里项目好几百个,不做默认列表 ——
 * 输关键字走服务端模糊匹配,搜到了点一下就绑。
 */
export function YunxiaoProjectPickerDialog({
  dir,
  current,
  onClose,
  onPick,
}: Props) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<YunxiaoProject[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (dir) {
      setSearch("");
      setHits(null);
    }
  }, [dir]);

  useEffect(() => {
    if (!dir) return;
    const q = search.trim();
    if (!q) {
      setHits(null);
      setLoading(false);
      return;
    }
    const token = getYunxiaoToken();
    const orgId = getCodeupOrgId();
    if (!token || !orgId) {
      toast.error("请先在设置里配置云效令牌和组织 ID");
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      listProjects(orgId, token, q)
        .then(setHits)
        .catch((e) => {
          setHits([]);
          toast.error(String(e));
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [dir, search]);

  return (
    <Dialog open={dir !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">关联云效项目</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            给「{dir?.split("/").pop()}」绑一个云效项目,底下的工程都跟着继承。
            {current ? `当前:${current.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="输入关键字搜索云效项目…"
          spellCheck={false}
          className="h-8 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
        />

        <div className="max-h-72 overflow-y-auto rounded border border-border/60 p-1">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              正在搜索…
            </div>
          ) : hits == null ? (
            <div className="px-2 py-2 text-[11px] text-muted-foreground">
              输入关键字开始搜索
            </div>
          ) : hits.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-muted-foreground">
              没有匹配的项目
            </div>
          ) : (
            hits.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.description || p.name}
                onClick={() => {
                  onPick({ id: p.id, name: p.name });
                  onClose();
                }}
                className="flex h-7 w-full min-w-0 cursor-pointer items-center rounded px-2 text-left text-[12px] text-foreground/85 transition-colors hover:bg-accent/70"
              >
                <span className="min-w-0 truncate">{p.name}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
