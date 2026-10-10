import { Spinner } from "@/components/ui/spinner";
import { useImeGuard } from "@/lib/ime";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { listRepoCandidates, type RepoCandidate } from "./lib/workitemLaunch";

const GROUPS: { key: RepoCandidate["group"]; label: string }[] = [
  { key: "recent", label: "最近用过" },
  { key: "current", label: "当前工程" },
  { key: "product", label: "产品目录下" },
];

/** 路径最后一段(仓库目录名),兼容末尾斜杠和 Windows 反斜杠。 */
export function repoName(path: string): string {
  const p = path.replace(/[/\\]+$/, "");
  return p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || path;
}

/**
 * 按「最近用过 → 当前工程 → 产品目录下」分组并按关键字过滤,空组不要。
 * 回车选的是返回值里第一组的第一条,和眼睛看到的第一条一致。
 */
export function groupRepoCandidates(
  candidates: readonly RepoCandidate[],
  query: string,
): { key: RepoCandidate["group"]; label: string; items: RepoCandidate[] }[] {
  const kw = query.trim().toLowerCase();
  const hit = (c: RepoCandidate) =>
    !kw ||
    c.name.toLowerCase().includes(kw) ||
    c.path.toLowerCase().includes(kw);
  return GROUPS.map((g) => ({
    ...g,
    items: candidates.filter((c) => c.group === g.key && hit(c)),
  })).filter((g) => g.items.length > 0);
}

/**
 * 叠在云效浮层右半边的面板外壳。不走 portal:浮层是 modal Popover,
 * portal 里的东西一点就算"点了外面",整个浮层会被关掉。
 */
export function PaneOverlay({
  onDismiss,
  children,
}: {
  /** 点面板外的灰底;不传就不响应(比如正在建 worktree)。 */
  onDismiss?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center p-6">
      <button
        type="button"
        aria-label="取消"
        tabIndex={-1}
        onClick={onDismiss}
        className="absolute inset-0 cursor-default bg-background/60 backdrop-blur-[1px]"
      />
      <div className="relative flex max-h-full w-[30rem] max-w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg">
        {children}
      </div>
    </div>
  );
}

/**
 * 给一条云效工作项选本地仓库。候选来自三处(最近用过 / 当前工程 /
 * 产品目录下的工程):搜索框一打开就有焦点,回车选第一条,Esc 取消;
 * 也能 Tab 到某一条上按回车选。
 */
export function WorkitemRepoPicker({
  projectId,
  label,
  current,
  onPick,
  onUnbind,
  onCancel,
}: {
  /** 云效项目 id,用来找"同项目下绑过的仓库"和绑了这个项目的产品目录。 */
  projectId: string;
  /** 面板标题里的工作项,如 "#YOEZ-402 新增打印"。 */
  label: string;
  /** 已经绑着的仓库;有才显示「解除绑定」。 */
  current: string | null;
  onPick: (repoRoot: string) => void;
  onUnbind: () => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<RepoCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { imeProps, isImeKey } = useImeGuard();

  useEffect(() => {
    let alive = true;
    setCandidates(null);
    setError(null);
    listRepoCandidates(projectId)
      .then((c) => {
        if (alive) setCandidates(c);
      })
      .catch((e) => {
        if (!alive) return;
        setCandidates([]);
        setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const grouped = useMemo(
    () => groupRepoCandidates(candidates ?? [], q),
    [candidates, q],
  );
  const first = grouped[0]?.items[0] ?? null;

  return (
    <PaneOverlay onDismiss={onCancel}>
      <div className="shrink-0 border-b border-border/60 px-3 pt-2.5 pb-2">
        <div className="text-[12.5px] font-semibold">这条在哪个仓库开发?</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {label}
        </div>
        <input
          // biome-ignore lint/a11y/noAutofocus: 面板弹出来就是为了选,光标该在搜索框
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          {...imeProps}
          onKeyDown={(e) => {
            e.stopPropagation();
            // 拼音直接上屏的回车、取消组字的 Esc 是给输入法的,不是选仓库/关面板
            if (isImeKey(e)) return;
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && first) onPick(first.path);
          }}
          placeholder="搜索仓库名或路径…"
          spellCheck={false}
          className="mt-2 h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {candidates == null ? (
          <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            正在找仓库…
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : q.trim() ? (
              "没有匹配的仓库"
            ) : (
              <>
                没找到这个云效项目对应的仓库。
                <br />
                在文件树里右键产品目录 → 关联云效项目,底下的工程就会出现在这里。
              </>
            )}
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.key} className="pb-1">
              <div className="px-3 pt-1.5 pb-0.5 text-[10.5px] font-medium text-muted-foreground/80">
                {g.label}
              </div>
              {g.items.map((c) => (
                <button
                  key={`${g.key}:${c.path}`}
                  type="button"
                  title={c.path}
                  // 用 click:右键/中键不会误选,Tab 过来按回车、空格也能选
                  onClick={() => onPick(c.path)}
                  className={cn(
                    "flex w-full min-w-0 cursor-pointer items-baseline gap-2 px-3 py-1 text-left hover:bg-accent/70",
                    c === first && q.trim() && "bg-accent/50",
                  )}
                >
                  <span className="shrink-0 text-[12.5px] text-foreground/90">
                    {c.name || repoName(c.path)}
                  </span>
                  {current === c.path && (
                    <span className="shrink-0 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-500">
                      当前
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-[10.5px] text-muted-foreground/70">
                    {c.path}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-1.5 text-[11px]">
        {current ? (
          <>
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              title={current}
            >
              现在绑的是 {repoName(current)}
            </span>
            <button
              type="button"
              onClick={onUnbind}
              className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10"
            >
              解除绑定
            </button>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            选过一次就记住,下次点开直接确认开工
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          取消
        </button>
      </div>
    </PaneOverlay>
  );
}
