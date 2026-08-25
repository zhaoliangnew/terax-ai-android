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
import { native } from "@/modules/ai/lib/native";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type CodeupRepo,
  getCodeupOrgId,
  getYunxiaoToken,
  listRepositories,
  setCodeupOrgId,
  sshUrlFor,
} from "./lib/codeupApi";
import { shellQuote } from "./lib/openExternally";
import { YunxiaoTokenRow } from "./YunxiaoTokenRow";

type Props = {
  /** 克隆到哪个目录(产品目录);null = 关闭。 */
  targetDir: string | null;
  onClose: () => void;
};

/**
 * 从云效搜索仓库直接克隆到本地项目目录:不用再去云效网页翻仓库
 * 地址。搜索走 Codeup OpenAPI,克隆走 ssh 地址。
 */
export function CloneRepoDialog({ targetDir, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgDraft, setOrgDraft] = useState("");
  const [search, setSearch] = useState("");
  const [repos, setRepos] = useState<CodeupRepo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CodeupRepo | null>(null);
  const [dirName, setDirName] = useState("");
  const [existing, setExisting] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 打开时重置,并读出本机存的令牌/组织 ID 和目标目录下已有的工程
  useEffect(() => {
    if (!targetDir) return;
    setToken(getYunxiaoToken());
    setOrgId(getCodeupOrgId());
    setOrgDraft("");
    setSearch("");
    setRepos(null);
    setSelected(null);
    setDirName("");
    native
      .readDir(targetDir)
      .then((entries) =>
        setExisting(entries.filter((e) => e.kind === "dir").map((e) => e.name)),
      )
      .catch(() => setExisting([]));
  }, [targetDir]);

  // 搜索防抖:停止输入 400ms 后请求
  useEffect(() => {
    if (!targetDir || !token || !orgId) return;
    const q = search.trim();
    if (!q) {
      setRepos(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      listRepositories(orgId, token, q)
        .then((r) => setRepos(r))
        .catch((e) => {
          setRepos([]);
          toast.error(String(e));
        })
        .finally(() => setSearching(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [targetDir, token, orgId, search]);

  const nameConflict =
    dirName.trim() !== "" && existing.includes(dirName.trim());

  const doClone = async () => {
    if (!targetDir || !orgId || !selected || busy) return;
    const dir = dirName.trim();
    if (!dir || nameConflict) return;
    setBusy(true);
    try {
      const ssh = sshUrlFor(orgId, selected.pathWithNamespace);
      const out = await native.runCommand(
        `git clone ${shellQuote(ssh)} ${shellQuote(dir)}`,
        targetDir,
        900,
      );
      if (out.exit_code !== 0) {
        toast.error(out.stderr || out.stdout || "克隆失败");
        return;
      }
      toast.success(`已克隆到 ${targetDir}/${dir}`);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={targetDir !== null}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">从云效克隆仓库</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            搜索云效上的代码库,选中后直接克隆到「
            {targetDir?.split("/").pop() ?? ""}」。
          </DialogDescription>
        </DialogHeader>

        {!token && <YunxiaoTokenRow onSaved={(t) => setToken(t)} />}

        {token && !orgId && (
          <div className="flex items-center gap-1.5">
            <input
              value={orgDraft}
              onChange={(e) => setOrgDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="云效组织 ID(仓库地址里 codeup.aliyun.com: 后的第一段)"
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
            <Button
              size="sm"
              disabled={!orgDraft.trim()}
              onClick={() => {
                setCodeupOrgId(orgDraft);
                setOrgId(orgDraft.trim());
              }}
              className="h-7 shrink-0 text-xs"
            >
              保存
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="搜索云效仓库(名称关键字)…"
            spellCheck={false}
            disabled={busy || !token || !orgId}
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
          />
          <div className="max-h-56 overflow-y-auto rounded border border-border/60 p-1">
            {searching ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
                <Spinner className="size-3" />
                正在搜索…
              </div>
            ) : repos == null ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                输入关键字搜索
              </div>
            ) : repos.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                没有匹配的仓库
              </div>
            ) : (
              repos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(r);
                    setDirName(r.pathWithNamespace.split("/").pop() ?? r.name);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-foreground/10",
                    selected?.id === r.id &&
                      "bg-emerald-500/15 font-semibold text-emerald-400",
                  )}
                >
                  <span className="min-w-0 truncate font-mono">
                    {r.pathWithNamespace}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {selected && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              本地目录名
            </div>
            <input
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              disabled={busy}
              className={cn(
                "h-7 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring",
                nameConflict && "border-destructive focus:border-destructive",
              )}
            />
            {nameConflict && (
              <div className="text-[11px] text-destructive">
                目标目录下已存在同名文件夹,请换一个名字
              </div>
            )}
          </div>
        )}

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
            disabled={busy || !selected || !dirName.trim() || nameConflict}
            onClick={() => void doClone()}
            className="gap-1 text-xs"
          >
            {busy && <Spinner className="size-3" />}
            克隆
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
