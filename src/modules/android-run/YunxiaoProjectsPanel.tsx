import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CheckListIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getCodeupOrgId,
  getYunxiaoToken,
  listProjects,
  projexUrl,
  setCodeupOrgId,
  type YunxiaoProject,
} from "./lib/codeupApi";
import { openExternally } from "./lib/openExternally";
import { YunxiaoTokenRow } from "./YunxiaoTokenRow";

/**
 * 侧栏的"云效项目"面板:项目管理(Projex)里的项目列表,
 * 显示名称/状态/描述,点击在浏览器打开项目页。
 */
export function YunxiaoProjectsPanel() {
  const [token, setToken] = useState<string | null>(() => getYunxiaoToken());
  const [orgId, setOrgId] = useState<string | null>(() => getCodeupOrgId());
  const [orgDraft, setOrgDraft] = useState("");
  const [projects, setProjects] = useState<YunxiaoProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version 是刷新按钮的重拉信号
  useEffect(() => {
    if (!token || !orgId) return;
    let alive = true;
    setLoading(true);
    listProjects(orgId, token)
      .then((p) => {
        if (alive) setProjects(p);
      })
      .catch((e) => {
        if (alive) {
          setProjects([]);
          toast.error(String(e));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, orgId, version]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q),
    );
  }, [projects, search]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
          <HugeiconsIcon
            icon={CheckListIcon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground"
          />
          云效项目
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || !token || !orgId}
          title="刷新项目列表"
          onClick={() => setVersion((v) => v + 1)}
          className="h-6 shrink-0 px-1.5"
        >
          {loading ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          )}
        </Button>
      </div>

      {!token && <YunxiaoTokenRow onSaved={(t) => setToken(t)} />}

      {token && !orgId && (
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            value={orgDraft}
            onChange={(e) => setOrgDraft(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="云效组织 ID"
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

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="搜索项目(名称/描述)…"
        spellCheck={false}
        className="h-7 w-full shrink-0 rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {projects == null ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
            {loading ? (
              <>
                <Spinner className="size-3" />
                正在加载项目列表…
              </>
            ) : (
              "配置令牌与组织 ID 后自动加载"
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">
            没有匹配的项目
          </div>
        ) : (
          filtered.map((p) => (
            <button
              key={p.id || p.name}
              type="button"
              title={`${p.name}${p.description ? `\n${p.description}` : ""} · 点击在浏览器打开`}
              onClick={() => orgId && openExternally(projexUrl(orgId, p.id))}
              className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70"
            >
              <span className="min-w-0 shrink-0 truncate">{p.name}</span>
              {p.statusName && (
                <span className="shrink-0 rounded bg-foreground/10 px-1 text-[9.5px] text-muted-foreground">
                  {p.statusName}
                </span>
              )}
              {p.description && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">
                  {p.description}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
