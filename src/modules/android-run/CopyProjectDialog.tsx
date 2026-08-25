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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createRepository,
  getCodeupOrgId,
  getYunxiaoToken,
  listProjects,
  stashOrgIdFromRemote,
  type YunxiaoProject,
} from "./lib/codeupApi";
import { openExternally, shellQuote } from "./lib/openExternally";
import { codeupPathFromRemote, codeupUrl } from "./lib/yunxiao";
import { YunxiaoTokenRow } from "./YunxiaoTokenRow";

type Props = {
  /** 要复制的工程目录;null = 关闭。 */
  sourcePath: string | null;
  /** 产品目录的父目录(工作区根),从这里列出可选的产品目录。 */
  rootDir: string | null;
  onClose: () => void;
};

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

/**
 * 把标准版工程复制一份到指定产品目录:选目标产品目录(可搜索)、
 * 填新 git 地址(一般只改项目拼音那一段),复制完自动把新副本的
 * origin 指到新地址。build/.gradle/.worktree 这类产物不带过去。
 */
export function CopyProjectDialog({ sourcePath, rootDir, onClose }: Props) {
  // 目录结构固定是 <工作区根>/<产品目录>/<工程>,所以候选产品目录
  // 从来源工程的祖父目录列——不管从哪棵树右键进来都对
  const baseDir = sourcePath ? dirname(dirname(sourcePath)) : rootDir;
  // 目标从云效项目管理的项目列表里选,本地目录用同名目录(没有会自动建)
  const [projects, setProjects] = useState<YunxiaoProject[] | null>(null);
  const [filter, setFilter] = useState("");
  const [targetDir, setTargetDir] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // 云效令牌与"在云效创建仓库"的进行态
  const [token, setToken] = useState<string | null>(null);
  const [creatingRepo, setCreatingRepo] = useState(false);
  // 选中目标下已有的工程名("missing" = 本地目录还不存在)
  const [existing, setExisting] = useState<string[] | "missing" | null>(null);

  useEffect(() => {
    if (!baseDir || !targetDir) {
      setExisting(null);
      return;
    }
    let alive = true;
    native
      .readDir(`${baseDir}/${targetDir}`)
      .then((entries) => {
        if (alive) {
          setExisting(
            entries
              .filter((e) => e.kind === "dir" && !e.name.startsWith("."))
              .map((e) => e.name)
              .sort((a, b) => a.localeCompare(b, "zh-CN")),
          );
        }
      })
      .catch(() => {
        if (alive) setExisting("missing");
      });
    return () => {
      alive = false;
    };
  }, [baseDir, targetDir]);

  const nameConflict =
    Array.isArray(existing) &&
    name.trim() !== "" &&
    existing.includes(name.trim());

  // 打开时:预填工程名和当前 origin 地址
  useEffect(() => {
    if (!sourcePath) return;
    setFilter("");
    setTargetDir(null);
    setName(basename(sourcePath));
    setGitUrl("");
    setToken(getYunxiaoToken());
    native
      .gitResolveRepo(sourcePath)
      .then((r) => (r ? native.gitRemoteUrl(r.repoRoot) : null))
      .then((u) => {
        if (u) {
          setGitUrl(u);
          stashOrgIdFromRemote(u);
        }
      })
      .catch(() => {});
  }, [sourcePath]);

  // 组织 ID:优先从当前填的地址解析,其次用之前记住的
  const orgId = useMemo(() => {
    const p = codeupPathFromRemote(gitUrl.trim() || null);
    return p?.split("/")[0] ?? getCodeupOrgId();
  }, [gitUrl]);

  // 拉云效项目列表(一次拉全,搜索在本地过滤)
  useEffect(() => {
    if (!sourcePath || !token || !orgId) return;
    let alive = true;
    setProjects(null);
    listProjects(orgId, token)
      .then((p) => {
        if (alive) setProjects(p);
      })
      .catch((e) => {
        if (alive) {
          setProjects([]);
          toast.error(String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [sourcePath, token, orgId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!projects) return [];
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, filter]);

  // 云效"产品仓库"分组地址:org + 顶层分组两段,在这里创建新仓库
  const groupUrl = useMemo(() => {
    const p = codeupPathFromRemote(gitUrl.trim() || null);
    if (!p) return null;
    const segs = p.split("/").filter(Boolean);
    return codeupUrl(segs.slice(0, Math.min(2, segs.length)).join("/"));
  }, [gitUrl]);

  // 按填写的新地址在云效直接建库,省去"去网页建完再回来"那趟
  const createRepoOnYunxiao = async () => {
    const p = codeupPathFromRemote(gitUrl.trim() || null);
    if (!p) {
      toast.error("请先填写合法的 codeup 仓库地址");
      return;
    }
    const org = stashOrgIdFromRemote(gitUrl.trim());
    const fullPath = p.split("/").slice(1).join("/");
    if (!org || !fullPath) {
      toast.error("地址里解析不出组织 ID 或仓库路径");
      return;
    }
    if (!token) {
      toast.error("请先在下方保存云效个人访问令牌");
      return;
    }
    setCreatingRepo(true);
    try {
      await createRepository(org, token, fullPath);
      toast.success(`云效仓库已创建:${p}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreatingRepo(false);
    }
  };

  const doCopy = async () => {
    if (!sourcePath || !baseDir || !targetDir || busy) return;
    const dirName = name.trim();
    const url = gitUrl.trim();
    if (!dirName || !url) return;
    const dst = `${baseDir}/${targetDir}/${dirName}`;
    if (dst === sourcePath) {
      toast.error("目标和来源是同一个目录");
      return;
    }
    setBusy(true);
    try {
      // 一步到位:存在检查 → rsync(排除构建产物和 worktree)→ 改 origin。
      // rsync 源路径带尾随 / 表示"拷内容",目标就是新工程目录本身。
      const script = [
        `if [ -e ${shellQuote(dst)} ]; then echo __DST_EXISTS__; exit 3; fi`,
        // 云效项目对应的本地目录可能还没建过
        `mkdir -p ${shellQuote(`${baseDir}/${targetDir}`)}`,
        `rsync -a --exclude build/ --exclude .gradle/ --exclude .cxx/ --exclude .worktree/ ${shellQuote(`${sourcePath}/`)} ${shellQuote(`${dst}/`)}`,
        `git -C ${shellQuote(dst)} remote set-url origin ${shellQuote(url)}`,
      ].join(" && ");
      const out = await native.runCommand(script, null, 600);
      if (out.exit_code !== 0) {
        if (out.stdout.includes("__DST_EXISTS__")) {
          toast.error(`目标目录已存在:${dst}`);
        } else {
          toast.error(out.stderr || out.stdout || "复制失败");
        }
        return;
      }
      toast.success(`已复制到 ${dst},origin 已指向新地址`);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={sourcePath !== null}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm">复制工程到项目目录</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            将「{sourcePath ? basename(sourcePath) : ""}
            」复制一份到所选项目目录,并把新副本的 git 远程地址改成下面填写的地址
            (构建产物和 worktree 不会带过去)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            目标项目(来自云效项目管理,本地用同名目录)
          </div>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="搜索云效项目…"
            spellCheck={false}
            disabled={busy}
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
          />
          <div className="max-h-56 overflow-y-auto rounded border border-border/60 p-1">
            {!token ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                需要云效个人访问令牌才能读取项目列表,请在下方保存令牌
              </div>
            ) : projects == null ? (
              <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
                <Spinner className="size-3" />
                正在读取云效项目…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                没有匹配的云效项目
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id || p.name}
                  type="button"
                  disabled={busy}
                  onClick={() => setTargetDir(p.name)}
                  className={cn(
                    "flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-foreground/10",
                    targetDir === p.name &&
                      "bg-emerald-500/15 font-semibold text-emerald-400",
                  )}
                >
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 让人先看见目标目录里已经有什么,再决定叫什么名 */}
        {targetDir && existing != null && (
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {existing === "missing" ? (
              <>本地还没有「{targetDir}」目录,复制时会自动创建</>
            ) : (
              <>
                「{targetDir}」下已有:
                {existing.length === 0 ? (
                  " (空)"
                ) : (
                  <span className="break-all">{` ${existing.join("、")}`}</span>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            新工程目录名
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
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
              「{targetDir}」下已存在同名工程,请换一个名字
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-medium text-muted-foreground">
            新 git 地址(一般只改项目拼音那一段)
          </div>
          <div className="flex items-center gap-1.5">
            <input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              disabled={busy}
              placeholder="git@codeup.aliyun.com:…/xxx.git"
              className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!groupUrl}
              title={groupUrl ?? "填写 codeup 地址后可跳转"}
              onClick={() => groupUrl && openExternally(groupUrl)}
              className="h-7 shrink-0 text-xs"
            >
              云效产品仓库
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={creatingRepo || busy || !gitUrl.trim()}
              title="用上面填写的地址直接在云效创建仓库,不用去网页建"
              onClick={() => void createRepoOnYunxiao()}
              className="h-7 shrink-0 gap-1 text-xs"
            >
              {creatingRepo && <Spinner className="size-3" />}
              在云效创建该仓库
            </Button>
          </div>
          {!token && <YunxiaoTokenRow onSaved={(t) => setToken(t)} />}
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
              busy ||
              !targetDir ||
              !name.trim() ||
              !gitUrl.trim() ||
              nameConflict
            }
            onClick={() => void doCopy()}
            className="gap-1 text-xs"
          >
            {busy && <Spinner className="size-3" />}
            复制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
