import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Folder01Icon, FolderGitTwoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createGroup, createRepository } from "./lib/codeupApi";
import { toPinyin } from "./lib/pinyin";

type ParentGroup = {
  id: number;
  /** 组织前缀已剥掉的路径,拼新代码库全路径要用它。 */
  relPath: string;
  name: string;
};

type Props = {
  /** 要在哪个代码组下新建;null = 关闭。 */
  parent: ParentGroup | null;
  orgId: string | null;
  token: string | null;
  onClose: () => void;
  /** 建好之后通知外面把这一层重新拉一次。 */
  onCreated: () => void;
};

const KIND_OPTIONS = [
  { value: "repo", label: "代码库", icon: FolderGitTwoIcon },
  { value: "group", label: "代码组", icon: Folder01Icon },
] as const;

/**
 * 名称转路径段:中文按字转拼音(下划线连接),其余字符原样保留后
 * 只留字母数字下划线短横线,且以字母数字或'_'开头。
 */
function slugify(raw: string): string {
  return toPinyin(raw, "_")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
    .replace(/^[^a-z0-9_]+/, "");
}

/**
 * 在选定的代码组下新建子代码组或代码库,字段照云效网页版的
 * "新建子代码组/新建代码库"弹窗来:名称、路径("由名称生成"按钮按需转
 * 拼音,不自动跟打,避免中文输入法组词过程中被半截拼音抢跑)、
 * 描述(必填)。公开性统一私有,不单独展示。
 */
export function CreateInGroupDialog({
  parent,
  orgId,
  token,
  onClose,
  onCreated,
}: Props) {
  const [kind, setKind] = useState<"repo" | "group">("repo");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  // 路径被手动改过就不再跟着名称走了;代码库名称一般本来就是英文,
  // 默认让路径跟着名称实时同步,省得再敲一遍
  const [pathTouched, setPathTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!parent) return;
    setKind("repo");
    setName("");
    setPath("");
    setPathTouched(false);
    setDescription("");
  }, [parent]);

  const submit = async () => {
    if (!parent || !orgId || !token || busy) return;
    const n = name.trim();
    const p = path.trim();
    const d = description.trim();
    if (!n || !p || !d) return;
    setBusy(true);
    try {
      if (kind === "repo") {
        await createRepository(orgId, token, `${parent.relPath}/${p}`);
        toast.success(`代码库已创建:${p}`);
      } else {
        await createGroup(orgId, token, parent.id, n, p, d);
        toast.success(`代码组已创建:${p}`);
      }
      onCreated();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={parent !== null}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            在「{parent?.name}」下新建{kind === "repo" ? "代码库" : "代码组"}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            路径:{parent?.relPath}/{path.trim() || "…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5">
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              onClick={() => {
                if (kind === o.value) return;
                setKind(o.value);
                setName("");
                setPath("");
                setPathTouched(false);
                setDescription("");
              }}
              className={cn(
                "flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border text-[12px] font-medium transition-colors",
                kind === o.value
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={14} strokeWidth={1.75} />
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {kind === "repo" ? "代码库名称" : "代码组名称"}
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              // 代码库名称一般本来就是拼音/英文,路径没被手动改过就
              // 直接跟着同步;代码组名称常是中文,靠"由名称生成"按钮转
              if (kind === "repo" && !pathTouched) setPath(slugify(v));
            }}
            onKeyDown={(e) => e.stopPropagation()}
            spellCheck={false}
            disabled={busy}
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            {kind === "repo" ? "代码库路径" : "代码组路径"}(字母、数字、'_'、
            '-',以字母数字或'_'开头)
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={path}
              onChange={(e) => {
                setPathTouched(true);
                setPath(e.target.value);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              disabled={busy}
              className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
            {kind === "group" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !name.trim()}
                title="用上面填的名称转一份拼音路径,中文按字转拼音"
                onClick={() => setPath(slugify(name))}
                className="h-7 shrink-0 text-xs"
              >
                由名称生成
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            描述
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={busy}
            rows={2}
            className="w-full resize-none rounded border border-input bg-transparent px-2 py-1.5 text-[12px] outline-none focus:border-ring"
          />
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onClose}
            className="text-xs"
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={
              busy || !name.trim() || !path.trim() || !description.trim()
            }
            onClick={() => void submit()}
            className="gap-1 text-xs"
          >
            {busy && <Spinner className="size-3" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
