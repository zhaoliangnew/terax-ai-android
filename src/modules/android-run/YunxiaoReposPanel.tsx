import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/modules/explorer/lib/contextActions";
import {
  ArrowRight01Icon,
  Folder01Icon,
  FolderGitTwoIcon,
  LinkSquare01Icon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreateInGroupDialog } from "./CreateInGroupDialog";
import {
  type CodeupNamespace,
  type CodeupRepo,
  getCodeupOrgId,
  getNamespaceInfo,
  getRepositoryInfo,
  getRootGroupPath,
  getYunxiaoToken,
  listChildNamespaces,
  listGroupRepositories,
  listMemberNames,
  searchNamespaces,
  setCodeupOrgId,
  sshUrlFor,
} from "./lib/codeupApi";
import { openExternally } from "./lib/openExternally";
import { codeupUrl } from "./lib/yunxiao";
import { YunxiaoTokenRow } from "./YunxiaoTokenRow";

/** 没在设置里配根分组时的默认值。 */
const DEFAULT_ROOT = "device2.0";

function lastSegment(path: string): string {
  return path.split("/").pop() ?? path;
}

function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function fmtSize(mb: number | null): string {
  if (mb == null || Number.isNaN(mb)) return "";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  if (mb >= 0.1) return `${mb.toFixed(1)}MB`;
  return mb > 0 ? "<0.1MB" : "0MB";
}

/** 树节点:一个代码组,子组和直属仓库都是展开时才去查。 */
type GroupNode = {
  id: number;
  relPath: string;
  name: string;
  description: string;
  /** undefined = 还没查过 */
  children?: GroupNode[];
  repos?: CodeupRepo[];
  loading: boolean;
};

/**
 * 侧栏的"云效 Git 仓库"面板:从设置的根分组开始,像文件夹一样
 * 一层一层读取 —— 每展开一个组,才用 ListNamespaces(parentId) 查它
 * 的子组、用仓库搜索查它的直属仓库,查过缓存。
 * 纯展示:点仓库行只是复制克隆地址,不动本地代码。
 */
export function YunxiaoReposPanel() {
  const [token, setToken] = useState<string | null>(() => getYunxiaoToken());
  const [orgId, setOrgId] = useState<string | null>(() => getCodeupOrgId());
  const [orgDraft, setOrgDraft] = useState("");
  const [root, setRoot] = useState<GroupNode | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<GroupNode[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [version, setVersion] = useState(0);
  const [rootSetting, setRootSetting] = useState<string | null>(() =>
    getRootGroupPath(),
  );
  // 成员 ID → 名字,显示创建人用;拉一次全局共用
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  // 在哪个组下新建代码库/代码组;null = 弹窗关闭
  const [createParent, setCreateParent] = useState<GroupNode | null>(null);

  // 设置窗口改了配置(localStorage),这边跟着刷新
  useEffect(() => {
    const sync = () => {
      setToken(getYunxiaoToken());
      setOrgId(getCodeupOrgId());
      setRootSetting(getRootGroupPath());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // 接口返回的路径可能带组织前缀,统一剥掉再比较
  const rel = (p: string) =>
    orgId && p.startsWith(`${orgId}/`) ? p.slice(orgId.length + 1) : p;
  const rootRel = rel(rootSetting ?? DEFAULT_ROOT);
  // 云效网页地址要带组织前缀
  const webUrlOf = (path: string) =>
    codeupUrl(
      orgId && !path.startsWith(`${orgId}/`) ? `${orgId}/${path}` : path,
    );

  /** 按路径改树上某个节点(主树和搜索结果里的节点都要改到)。 */
  const patchNode = (relPath: string, updater: (n: GroupNode) => GroupNode) => {
    const walk = (n: GroupNode): GroupNode => {
      if (n.relPath === relPath) return updater(n);
      if (!n.children) return n;
      return { ...n, children: n.children.map(walk) };
    };
    setRoot((cur) => (cur ? walk(cur) : cur));
    setSearchResults((cur) => (cur ? cur.map(walk) : cur));
  };

  /** 查一个组的下一层子组,写回树上对应节点;描述随后逐个补齐。 */
  const loadLevel = (node: GroupNode) => {
    if (!token || !orgId) return;
    patchNode(node.relPath, (n) => ({ ...n, loading: true }));
    Promise.all([
      listChildNamespaces(orgId, token, node.id),
      listGroupRepositories(orgId, token, node.id),
    ])
      .then(([kids, reps]) => {
        const children = kids.map((k: CodeupNamespace): GroupNode => {
          // 返回的路径可能只有自己那一段,补上父路径
          const raw = rel(k.pathWithNamespace);
          const relPath = raw.includes("/") ? raw : `${node.relPath}/${raw}`;
          return {
            id: k.id,
            relPath,
            name: k.name || lastSegment(relPath),
            description: k.description,
            loading: false,
          };
        });
        const repos = reps.sort((a, b) =>
          a.name.localeCompare(b.name, "zh-CN"),
        );
        patchNode(node.relPath, (n) => ({
          ...n,
          loading: false,
          children,
          repos,
        }));
        // 列表接口都不带描述:组描述用 GetNamespace 补,
        // 仓库描述用 GetRepository 补,补到一个显示一个
        void (async () => {
          for (const c of children) {
            if (c.description) continue;
            const info = await getNamespaceInfo(orgId, token, c.relPath);
            if (info?.description || info?.name) {
              patchNode(c.relPath, (n) => ({
                ...n,
                name: info.name || n.name,
                description: info.description || n.description,
              }));
            }
          }
          for (const r of repos) {
            if (
              r.description &&
              r.creatorUid &&
              r.lastActivityAt &&
              r.repositorySize != null
            ) {
              continue;
            }
            const info = await getRepositoryInfo(orgId, token, r.id);
            if (info) {
              patchNode(node.relPath, (n) => ({
                ...n,
                repos: (n.repos ?? []).map((x) =>
                  x.id === r.id
                    ? {
                        ...x,
                        description: x.description || info.description,
                        creatorUid: x.creatorUid || info.creatorUid,
                        lastActivityAt: x.lastActivityAt || info.lastActivityAt,
                        repositorySize: x.repositorySize ?? info.repositorySize,
                      }
                    : x,
                ),
              }));
            }
          }
        })();
      })
      .catch((e) => {
        patchNode(node.relPath, (n) => ({
          ...n,
          loading: false,
          children: [],
          repos: [],
        }));
        toast.error(String(e));
      });
  };

  // 打开/刷新:只解析根分组并读它的第一层
  // biome-ignore lint/correctness/useExhaustiveDependencies: version 是刷新信号;rootRel 由 rootSetting/orgId 派生
  useEffect(() => {
    if (!token || !orgId) return;
    let alive = true;
    setLoadingRoot(true);
    setRootError(null);
    setRoot(null);
    setExpanded(new Set());
    getNamespaceInfo(orgId, token, rootRel)
      .then((info) => {
        if (!alive) return;
        if (!info) {
          setRootError(`没有找到分组「${rootRel}」,检查设置里的根分组路径`);
          return;
        }
        const rootNode: GroupNode = {
          id: info.id,
          relPath: rootRel,
          name: info.name || lastSegment(rootRel),
          description: info.description,
          loading: false,
        };
        setRoot(rootNode);
        loadLevel(rootNode);
        // 成员表后台拉一次,创建人 ID 换名字;令牌没给"组织信息"读权限
        // 会 403,这里提示一下,不然创建人一直不显示都不知道为啥
        listMemberNames(orgId, token)
          .then((m) => {
            if (alive) setMemberNames(m);
          })
          .catch((e) => {
            if (alive)
              toast.error(`创建人加载失败,令牌可能缺少组织成员读权限:${e}`);
          });
      })
      .catch((e) => {
        if (alive) setRootError(String(e));
      })
      .finally(() => {
        if (alive) setLoadingRoot(false);
      });
    return () => {
      alive = false;
    };
  }, [token, orgId, rootSetting, version]);

  // 搜索:搜的是"仓库组"(组名就是客户/项目名),命中的组可以
  // 直接展开继续逐层看
  // biome-ignore lint/correctness/useExhaustiveDependencies: rel 只依赖 orgId,已在依赖里
  useEffect(() => {
    if (!token || !orgId) return;
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchNamespaces(orgId, token, q)
        .then((gs) => {
          const nodes = gs
            .filter((g) => {
              const r = rel(g.pathWithNamespace);
              return r !== rootRel && r.startsWith(`${rootRel}/`);
            })
            .map(
              (g): GroupNode => ({
                id: g.id,
                relPath: rel(g.pathWithNamespace),
                name: g.name || lastSegment(rel(g.pathWithNamespace)),
                description: g.description,
                loading: false,
              }),
            );
          setSearchResults(nodes);
          // 描述照旧逐个补
          void (async () => {
            for (const n of nodes) {
              if (n.description) continue;
              const info = await getNamespaceInfo(orgId, token, n.relPath);
              if (info?.description) {
                patchNode(n.relPath, (x) => ({
                  ...x,
                  description: info.description,
                }));
              }
            }
          })();
        })
        .catch((e) => {
          setSearchResults([]);
          toast.error(String(e));
        })
        .finally(() => setSearching(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [token, orgId, search, rootRel]);

  const toggle = (node: GroupNode) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(node.relPath)) {
        next.delete(node.relPath);
      } else {
        next.add(node.relPath);
        if (node.children === undefined && !node.loading) loadLevel(node);
      }
      return next;
    });
  };

  const repoRow = (r: CodeupRepo, depth: number) => {
    const ssh = orgId ? sshUrlFor(orgId, r.pathWithNamespace) : "";
    // standard 组下的是标准仓库,其余都算非标定制
    const isStandard = rel(r.pathWithNamespace).startsWith(
      `${rootRel}/standard/`,
    );
    return (
      <ContextMenu key={r.pathWithNamespace}>
        <ContextMenuTrigger asChild>
          <div className="group flex items-center">
            <button
              type="button"
              title={`${ssh}${r.description ? `\n${r.description}` : ""} · 点击复制地址`}
              onClick={() => {
                void copyToClipboard(ssh);
                toast.success(`已复制:${ssh}`);
              }}
              style={{ paddingLeft: 8 + depth * 16 }}
              className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm pr-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70"
            >
              {/* 占住组行展开箭头那一列,和父组拉开一级缩进 */}
              <span className="size-3.5 shrink-0" />
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-px text-[9.5px]",
                  isStandard
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-foreground/10 text-muted-foreground",
                )}
              >
                {isStandard ? "标准" : "非标"}
              </span>
              <span className="shrink-0">{r.name}</span>
              {r.description && (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">
                  {r.description}
                </span>
              )}
              {(memberNames[r.creatorUid] ||
                r.lastActivityAt ||
                r.repositorySize != null) && (
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                  {[
                    memberNames[r.creatorUid],
                    fmtDate(r.lastActivityAt),
                    fmtSize(r.repositorySize),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </button>
            <button
              type="button"
              title="在云效中打开"
              onClick={() => openExternally(webUrlOf(r.pathWithNamespace))}
              className="invisible shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:visible"
            >
              <HugeiconsIcon
                icon={LinkSquare01Icon}
                size={12}
                strokeWidth={1.75}
              />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <ContextMenuItem
            className="text-[12px]"
            onSelect={() => {
              void copyToClipboard(ssh);
              toast.success(`已复制:${ssh}`);
            }}
          >
            复制克隆地址
          </ContextMenuItem>
          <ContextMenuItem
            className="text-[12px]"
            onSelect={() => openExternally(webUrlOf(r.pathWithNamespace))}
          >
            在云效中打开
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-[12px] text-destructive focus:text-destructive"
            onSelect={() => {
              openExternally(webUrlOf(r.pathWithNamespace));
              toast.info("已在浏览器打开该仓库页面,请在网页里手动删除");
            }}
          >
            删除代码库(前往云效网页)…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderGroup = (node: GroupNode, depth: number) => {
    const isOpen = expanded.has(node.relPath);
    return (
      <div key={node.relPath}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="group flex items-center">
              <button
                type="button"
                onClick={() => toggle(node)}
                title={`${node.relPath}${node.description ? ` · ${node.description}` : ""}`}
                style={{ paddingLeft: 8 + depth * 16 }}
                className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm pr-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70"
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={12}
                    strokeWidth={2.25}
                    className={cn(
                      "transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                </span>
                <HugeiconsIcon
                  icon={Folder01Icon}
                  size={14}
                  strokeWidth={1.75}
                  className="size-4 shrink-0 text-muted-foreground/70"
                />
                <span className="shrink-0 font-medium">{node.name}</span>
                {node.description && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground/60">
                    {node.description}
                  </span>
                )}
              </button>
              <button
                type="button"
                title="在此代码组下新建代码库/代码组"
                onClick={() => setCreateParent(node)}
                className="invisible shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:visible"
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  size={12}
                  strokeWidth={1.75}
                />
              </button>
              <button
                type="button"
                title="在云效中打开"
                onClick={() => openExternally(webUrlOf(node.relPath))}
                className="invisible shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:visible"
              >
                <HugeiconsIcon
                  icon={LinkSquare01Icon}
                  size={12}
                  strokeWidth={1.75}
                />
              </button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-52">
            <ContextMenuItem
              className="text-[12px]"
              onSelect={() => setCreateParent(node)}
            >
              新建代码库/代码组…
            </ContextMenuItem>
            <ContextMenuItem
              className="text-[12px]"
              onSelect={() => openExternally(webUrlOf(node.relPath))}
            >
              在云效中打开
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-[12px] text-destructive focus:text-destructive"
              onSelect={() => {
                openExternally(webUrlOf(node.relPath));
                toast.info(
                  "云效暂未开放删除代码组的接口,已在浏览器打开该组页面,请在网页里手动删除",
                );
              }}
            >
              删除代码组(前往云效网页)…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isOpen && (
          <>
            {node.loading && (
              <div
                style={{ paddingLeft: 8 + (depth + 1) * 16 }}
                className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"
              >
                <Spinner className="size-3" />
                加载中…
              </div>
            )}
            {(node.children ?? []).map((c) => renderGroup(c, depth + 1))}
            {(node.repos ?? []).map((r) => repoRow(r, depth + 1))}
            {!node.loading &&
              node.children !== undefined &&
              node.children.length === 0 &&
              (node.repos ?? []).length === 0 && (
                <div
                  style={{ paddingLeft: 8 + (depth + 1) * 16 }}
                  className="py-1 text-[11px] text-muted-foreground"
                >
                  (空)
                </div>
              )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
          <HugeiconsIcon
            icon={FolderGitTwoIcon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground"
          />
          云效 Git 仓库
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={!root}
            title={
              root ? `在「${root.name}」下新建代码库/代码组` : "根分组还没加载"
            }
            onClick={() => root && setCreateParent(root)}
            className="h-6 shrink-0 px-1.5"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} strokeWidth={1.75} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingRoot || !token || !orgId}
            title="刷新"
            onClick={() => setVersion((v) => v + 1)}
            className="h-6 shrink-0 px-1.5"
          >
            {loadingRoot ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon
                icon={Refresh01Icon}
                size={13}
                strokeWidth={1.75}
              />
            )}
          </Button>
        </div>
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
        placeholder="搜索仓库组…"
        spellCheck={false}
        className="h-7 w-full shrink-0 rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.trim() ? (
          searching ? (
            <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
              <Spinner className="size-3" />
              正在搜索…
            </div>
          ) : searchResults == null || searchResults.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-muted-foreground">
              没有匹配的仓库组
            </div>
          ) : (
            searchResults.map((n) => renderGroup(n, 0))
          )
        ) : rootError ? (
          <div className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
            {rootError}
          </div>
        ) : root == null ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
            {loadingRoot ? (
              <>
                <Spinner className="size-3" />
                正在定位根分组…
              </>
            ) : (
              "配置令牌与组织 ID 后自动加载"
            )}
          </div>
        ) : (
          <>
            {root.loading && (
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                <Spinner className="size-3" />
                加载中…
              </div>
            )}
            {(root.children ?? []).map((c) => renderGroup(c, 0))}
            {(root.repos ?? []).map((r) => repoRow(r, 0))}
          </>
        )}
      </div>

      <CreateInGroupDialog
        parent={createParent}
        orgId={orgId}
        token={token}
        onClose={() => setCreateParent(null)}
        onCreated={() => {
          if (!createParent) return;
          setExpanded((cur) => new Set(cur).add(createParent.relPath));
          loadLevel(createParent);
        }}
      />
    </div>
  );
}
