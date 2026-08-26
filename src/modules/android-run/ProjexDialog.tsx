import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckListIcon,
  FolderLibraryIcon,
  LinkSquare01Icon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getCodeupOrgId,
  getSelf,
  getWorkitemViews,
  getYunxiaoToken,
  listMembers,
  listProjects,
  projexUrl,
  searchWorkitems,
  setCodeupOrgId,
  setWorkitemViews,
  updateWorkitem,
  type Workitem,
  type WorkitemCategory,
  type WorkitemView,
  workitemUrl,
  type YunxiaoMember,
  type YunxiaoProject,
  type YunxiaoSelf,
} from "./lib/codeupApi";
import { openExternally } from "./lib/openExternally";
import { YunxiaoTokenRow } from "./YunxiaoTokenRow";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 浮层挂在哪个元素上(底栏那个按钮)。 */
  anchor: React.ReactNode;
};

type CategoryState = {
  items: Workitem[];
  total: number;
  page: number;
  loading: boolean;
  error: string | null;
};

const EMPTY_CAT: CategoryState = {
  items: [],
  total: 0,
  page: 1,
  loading: false,
  error: null,
};

const CATEGORIES: { value: WorkitemCategory; label: string }[] = [
  { value: "Req", label: "需求" },
  { value: "Task", label: "任务" },
];

const PER_PAGE = 30;

/** "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD",给 <input type="date"> 用。 */
function toDateInputValue(raw: string): string {
  return raw.slice(0, 10);
}

/**
 * 表格里的可编辑单元格:平时只是文字,双击才变输入框。
 * 之所以不做成常驻输入框:日期输入框点一下就弹出日历,很容易误触;
 * 而且提交只认"值真的变了",光是点到别处不会触发保存。
 */
function EditableCell({
  editable,
  display,
  type,
  editValue,
  onCommit,
}: {
  editable: boolean;
  display: string;
  type: "date" | "number";
  /** 进入编辑态时输入框里的初始值(日期要 YYYY-MM-DD)。 */
  editValue: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!editable}
        title={editable ? "双击修改" : undefined}
        onDoubleClick={() => setEditing(true)}
        className={cn(
          "block h-6 w-full truncate rounded px-1 text-left text-[11px]",
          editable && "cursor-pointer hover:bg-foreground/10",
        )}
      >
        {display}
      </button>
    );
  }

  const finish = (el: HTMLInputElement, commit: boolean) => {
    setEditing(false);
    const v = el.value.trim();
    // 没改就别发请求,免得点一下别处就"保存"一次
    if (commit && v && v !== editValue) onCommit(v);
  };

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: 双击进入编辑态,光标就该在这
      autoFocus
      type={type}
      defaultValue={editValue}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget, true);
        if (e.key === "Escape") finish(e.currentTarget, false);
      }}
      onBlur={(e) => finish(e.currentTarget, true)}
      className="h-6 w-full rounded border border-ring bg-transparent px-1 text-[11px] outline-none"
    />
  );
}

/**
 * 改负责人用的选择器:成员几百号人,平铺下拉根本没法找,
 * 所以双击后变成"输入关键字过滤"的小浮层。
 */
function MemberPicker({
  members,
  onPick,
  onCancel,
}: {
  members: YunxiaoMember[];
  onPick: (m: YunxiaoMember) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = kw
      ? members.filter((m) => m.name.toLowerCase().includes(kw))
      : members;
    return list.slice(0, 50);
  }, [members, q]);

  return (
    <div className="relative">
      <input
        // biome-ignore lint/a11y/noAutofocus: 双击进入选择态,光标就该在搜索框
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && hits[0]) onPick(hits[0]);
        }}
        onBlur={onCancel}
        placeholder="搜索成员…"
        spellCheck={false}
        className="h-6 w-full rounded border border-ring bg-transparent px-1 text-[11px] outline-none"
      />
      <div className="absolute top-7 left-0 z-50 max-h-56 w-44 overflow-y-auto rounded-md border border-border/60 bg-popover py-1 shadow-lg">
        {hits.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            没有匹配的成员
          </div>
        ) : (
          hits.map((m) => (
            <button
              key={m.userId}
              type="button"
              // onMouseDown 早于 input 的 blur,不然点击会被 onCancel 抢先吃掉
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
              }}
              className="block w-full cursor-pointer truncate px-2 py-1 text-left text-[12px] text-foreground/85 hover:bg-accent/70"
            >
              {m.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** 状态名没有固定枚举(不同项目模板不一样),按关键字给个颜色分组。 */
function statusColorClass(name: string): string {
  if (
    name === "已完成" ||
    name.includes("取消") ||
    name.includes("关闭") ||
    name.includes("废弃")
  ) {
    return "bg-foreground/10 text-muted-foreground/70";
  }
  if (name.includes("完成") || name.includes("通过") || name.includes("验收")) {
    return "bg-emerald-500/15 text-emerald-500";
  }
  if (name.includes("处理") || name.includes("待") || name.includes("未开始")) {
    return "bg-blue-500/15 text-blue-500";
  }
  if (
    name.includes("进行") ||
    name.includes("开发") ||
    name.includes("测试") ||
    name.includes("评审") ||
    name.includes("修复")
  ) {
    return "bg-amber-500/15 text-amber-500";
  }
  return "bg-foreground/10 text-muted-foreground";
}

/**
 * 云效项目弹窗:左侧项目列表,右上需求/任务两个 tab(带数量),
 * 右下是选中项目 + 选中类型的工作项列表,支持翻页。点标题去浏览器
 * 打开详情;负责人是自己的行可以直接改状态/负责人/时间/工时。
 */
export function ProjexDialog({ open, onOpenChange, anchor }: Props) {
  const [token, setToken] = useState<string | null>(() => getYunxiaoToken());
  const [orgId, setOrgId] = useState<string | null>(() => getCodeupOrgId());
  const [orgDraft, setOrgDraft] = useState("");
  const [projects, setProjects] = useState<YunxiaoProject[] | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<YunxiaoProject | null>(null);
  const [category, setCategory] = useState<WorkitemCategory>("Req");
  const [cats, setCats] = useState<Record<WorkitemCategory, CategoryState>>({
    Req: EMPTY_CAT,
    Task: EMPTY_CAT,
  });
  // 成员列表(每人一条),改负责人的选择器要用
  const [members, setMembers] = useState<YunxiaoMember[]>([]);
  // 正在给哪条工作项改负责人
  const [pickingAssignee, setPickingAssignee] = useState<string | null>(null);
  // 只看负责人是自己的(交给服务端过滤,几千条不可能拉回来本地筛)
  const [onlyMine, setOnlyMine] = useState(false);
  // 令牌属于谁,拿来判断哪些工作项是自己的(自动查,不用手填)
  const [self, setSelf] = useState<YunxiaoSelf | null>(null);

  // 自己加的云效视图快捷入口(跨项目的视图没接口,只能跳网页)
  const [views, setViews] = useState<WorkitemView[]>([]);
  // 正在编辑第几个视图;-1 = 新增,null = 没在编辑
  const [editingView, setEditingView] = useState<number | null>(null);
  const [viewDraft, setViewDraft] = useState<WorkitemView>({
    name: "",
    url: "",
  });

  useEffect(() => {
    if (!open) return;
    setToken(getYunxiaoToken());
    setOrgId(getCodeupOrgId());
    setViews(getWorkitemViews());
    setEditingView(null);
  }, [open]);

  const saveViews = (next: WorkitemView[]) => {
    setViews(next);
    setWorkitemViews(next);
  };

  const commitViewDraft = () => {
    const name = viewDraft.name.trim();
    const url = viewDraft.url.trim();
    if (!name || !url) return;
    const next = [...views];
    if (editingView === -1) next.push({ name, url });
    else if (editingView != null) next[editingView] = { name, url };
    saveViews(next);
    setEditingView(null);
  };

  const loadProjects = (keyword = search) => {
    if (!token || !orgId) return;
    setLoadingProjects(true);
    listProjects(orgId, token, keyword)
      .then((p) => setProjects(p))
      .catch((e) => {
        setProjects([]);
        toast.error(String(e));
      })
      .finally(() => setLoadingProjects(false));
  };

  useEffect(() => {
    if (!open || !token || !orgId) return;
    listMembers(orgId, token)
      .then(setMembers)
      .catch(() => {});
    getSelf(token)
      .then(setSelf)
      .catch(() => {});
  }, [open, token, orgId]);

  // 项目有好几百个,列表不全量拉:关键字交给服务端模糊匹配,输入停 350ms 再查
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjects 只依赖 token/orgId/search,已覆盖
  useEffect(() => {
    if (!open || !token || !orgId) return;
    const timer = window.setTimeout(() => loadProjects(search), 350);
    return () => window.clearTimeout(timer);
  }, [open, token, orgId, search]);

  const loadCategory = (
    projectId: string,
    cat: WorkitemCategory,
    page: number,
  ) => {
    if (!token || !orgId) return;
    setCats((cur) => ({
      ...cur,
      [cat]: { ...cur[cat], page, loading: true, error: null },
    }));
    searchWorkitems(
      orgId,
      token,
      projectId,
      cat,
      page,
      PER_PAGE,
      onlyMine ? (self?.id ?? undefined) : undefined,
    )
      .then(({ items, total }) => {
        setCats((cur) => ({
          ...cur,
          [cat]: { items, total, page, loading: false, error: null },
        }));
      })
      .catch((e) => {
        setCats((cur) => ({
          ...cur,
          [cat]: { ...EMPTY_CAT, page, error: String(e) },
        }));
      });
  };

  // 选中项目/切"只看我的"时:两种类型都从第一页重拉,切 tab 就不用等了
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadCategory 的依赖都已列出
  useEffect(() => {
    if (!selected) return;
    loadCategory(selected.id, "Req", 1);
    loadCategory(selected.id, "Task", 1);
  }, [selected, token, orgId, onlyMine, self]);

  // 过滤已经在服务端做了,这里直接用返回结果
  const filteredProjects = projects ?? [];

  const active = cats[category];
  const totalPages = Math.max(1, Math.ceil(active.total / PER_PAGE));

  /** 创建者或负责人是自己就能改(比 id,组织里有重名的人)。 */
  const canEdit = (w: Workitem) =>
    !!self && (w.assignedToId === self.id || w.creatorId === self.id);

  /**
   * 先乐观更新,失败就整条回滚回改之前的值 —— 不然界面显示的是没保存
   * 成功的假数据(比如 403 之后状态看着像改成功了)。
   */
  const patchItem = (
    workitemId: string,
    patch: Partial<Workitem>,
    apiPatch: Parameters<typeof updateWorkitem>[3],
  ) => {
    if (!orgId || !token) return;
    const before = cats[category].items.find((it) => it.id === workitemId);
    setCats((cur) => ({
      ...cur,
      [category]: {
        ...cur[category],
        items: cur[category].items.map((it) =>
          it.id === workitemId ? { ...it, ...patch } : it,
        ),
      },
    }));
    updateWorkitem(orgId, token, workitemId, apiPatch).catch((e) => {
      toast.error(`保存失败:${e}`);
      if (!before) return;
      setCats((cur) => ({
        ...cur,
        [category]: {
          ...cur[category],
          items: cur[category].items.map((it) =>
            it.id === workitemId ? before : it,
          ),
        },
      }));
    });
  };

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={8}
        // 新建/编辑视图是个套在里面的 Dialog,它渲染在 portal 里,
        // 点它会被当成"点了外面"把浮层关掉 —— 编辑期间不让关
        onInteractOutside={(e) => {
          if (editingView !== null) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[44rem] max-h-[calc(100vh-5rem)] w-[74rem] max-w-[calc(100vw-2rem)] flex-col gap-0 p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <HugeiconsIcon
                icon={CheckListIcon}
                size={14}
                strokeWidth={1.75}
              />
              云效项目
            </div>
            <button
              type="button"
              disabled={!self}
              title={
                self
                  ? `只看负责人是 ${self.name} 的需求/任务`
                  : "正在识别当前用户…"
              }
              onClick={() => setOnlyMine((v) => !v)}
              className={cn(
                "flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] transition-colors disabled:cursor-default disabled:opacity-50",
                onlyMine
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  onlyMine ? "bg-emerald-400" : "bg-muted-foreground/40",
                )}
              />
              只看我负责的
            </button>
          </div>
          <div className="flex min-w-0 flex-1 justify-center px-2">
            {selected && orgId && (
              <button
                type="button"
                title="在云效中打开这个项目"
                onClick={() => openExternally(projexUrl(orgId, selected.id))}
                className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full bg-foreground/5 px-3 py-1 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <span className="min-w-0 truncate">{selected.name}</span>
                <HugeiconsIcon
                  icon={LinkSquare01Icon}
                  size={12}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={loadingProjects || !token || !orgId}
              title="刷新项目列表"
              onClick={() => loadProjects(search)}
              className="h-7 px-2"
            >
              {loadingProjects ? (
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

        <Dialog
          open={editingView !== null}
          onOpenChange={(o) => {
            if (!o) setEditingView(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">
                {editingView === -1 ? "添加工作项视图" : "编辑工作项视图"}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                在云效里打开你要的视图,把地址栏的完整网址复制过来。
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                名称
              </div>
              <input
                autoFocus
                value={viewDraft.name}
                onChange={(e) =>
                  setViewDraft((d) => ({ ...d, name: e.target.value }))
                }
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="如 我负责的"
                spellCheck={false}
                className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">
                网址
              </div>
              <input
                value={viewDraft.url}
                onChange={(e) =>
                  setViewDraft((d) => ({ ...d, url: e.target.value }))
                }
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitViewDraft();
                }}
                placeholder="https://devops.aliyun.com/projex/…"
                spellCheck={false}
                className="h-7 w-full rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
              />
            </div>

            <DialogFooter>
              {editingView !== null && editingView >= 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    saveViews(views.filter((_, i) => i !== editingView));
                    setEditingView(null);
                  }}
                  className="mr-auto text-xs text-destructive"
                >
                  删除
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingView(null)}
                className="text-xs"
              >
                取消
              </Button>
              <Button
                size="sm"
                disabled={!viewDraft.name.trim() || !viewDraft.url.trim()}
                onClick={commitViewDraft}
                className="text-xs"
              >
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {!token ? (
          <div className="p-3">
            <YunxiaoTokenRow onSaved={(t) => setToken(t)} />
          </div>
        ) : !orgId ? (
          <div className="flex items-center gap-1.5 p-3">
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
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex w-64 shrink-0 flex-col border-r border-border/60">
              {/* 工作项视图:跨项目的视图云效没开放接口,只能跳网页,
                  名字和地址都由用户自己加 */}
              <div className="shrink-0 border-b border-border/60 px-2 pt-2 pb-1.5">
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    工作项视图
                  </span>
                  <button
                    type="button"
                    title="添加一个云效视图入口"
                    onClick={() => {
                      setViewDraft({ name: "", url: "" });
                      setEditingView(-1);
                    }}
                    className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      size={13}
                      strokeWidth={1.75}
                    />
                  </button>
                </div>
                {views.length === 0 ? (
                  <div className="px-1 py-0.5 text-[11px] text-muted-foreground/60">
                    点 + 添加(如 我负责的)
                  </div>
                ) : (
                  views.map((v, i) => (
                    <button
                      key={`${v.name}-${v.url}`}
                      type="button"
                      title={`${v.url}\n(右键编辑)`}
                      onClick={() => openExternally(v.url)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setViewDraft(v);
                        setEditingView(i);
                      }}
                      className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-accent/70"
                    >
                      <HugeiconsIcon
                        icon={LinkSquare01Icon}
                        size={12}
                        strokeWidth={1.75}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 truncate">{v.name}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="px-2 pt-2 pb-1.5">
                <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">
                  项目
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="搜索项目(模糊匹配)…"
                  spellCheck={false}
                  className="h-7 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
                />
              </div>
              {/* 选中的项目钉在搜索框下面,列表滚多远都能看见 */}
              {selected && (
                <div className="shrink-0 border-b border-border/60 px-1 pb-1.5">
                  <button
                    type="button"
                    title={selected.description || selected.name}
                    className="flex h-7 w-full min-w-0 cursor-default items-center gap-2 rounded-sm bg-emerald-500/15 px-2 text-left text-[12.5px] font-medium text-emerald-400"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {selected.name}
                    </span>
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                {projects == null ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
                    {loadingProjects ? (
                      <>
                        <Spinner className="size-3" />
                        正在加载…
                      </>
                    ) : (
                      "没有数据"
                    )}
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-muted-foreground">
                    没有匹配的项目
                  </div>
                ) : (
                  filteredProjects
                    // 钉在上面了,列表里就别重复一遍
                    .filter((p) => p.id !== selected?.id)
                    .map((p) => (
                      <button
                        key={p.id || p.name}
                        type="button"
                        onClick={() => setSelected(p)}
                        title={p.description || p.name}
                        className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-[12.5px] transition-colors hover:bg-accent/70"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {p.name}
                        </span>
                      </button>
                    ))
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {!selected ? (
                <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <HugeiconsIcon
                      icon={FolderLibraryIcon}
                      size={22}
                      strokeWidth={1.5}
                      className="text-muted-foreground/50"
                    />
                    先在左边选一个项目
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 p-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setCategory(c.value)}
                        className={cn(
                          "flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium transition-colors",
                          category === c.value
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                            : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                        )}
                      >
                        {c.label}
                        <span className="rounded bg-foreground/10 px-1 text-[10px] tabular-nums">
                          {cats[c.value].loading ? "…" : cats[c.value].total}
                        </span>
                      </button>
                    ))}
                    {self && (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {self.name} · 自己创建或负责的可双击修改
                      </span>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto">
                    {active.loading ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
                        <Spinner className="size-3" />
                        正在加载…
                      </div>
                    ) : active.error ? (
                      <div className="px-3 py-3 text-[11px] leading-relaxed text-destructive">
                        {active.error}
                      </div>
                    ) : active.items.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] text-muted-foreground">
                        没有{category === "Req" ? "需求" : "任务"}
                      </div>
                    ) : (
                      <table className="w-full min-w-[42rem] table-fixed border-collapse text-[12px]">
                        <thead className="sticky top-0 bg-card/95 text-[11px] text-muted-foreground backdrop-blur">
                          <tr className="border-b border-border/60">
                            <th className="min-w-40 px-3 py-1.5 text-left font-medium">
                              标题
                            </th>
                            <th className="w-24 px-3 py-1.5 text-left font-medium">
                              状态
                            </th>
                            <th className="w-20 px-3 py-1.5 text-left font-medium">
                              负责人
                            </th>
                            <th className="w-20 px-3 py-1.5 text-left font-medium">
                              创建者
                            </th>
                            <th className="w-28 px-3 py-1.5 text-left font-medium whitespace-nowrap">
                              计划开始
                            </th>
                            <th className="w-28 px-3 py-1.5 text-left font-medium whitespace-nowrap">
                              计划完成
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {active.items.map((w) => {
                            const editable = canEdit(w);
                            return (
                              <tr
                                key={w.id}
                                className="border-b border-border/40 transition-colors hover:bg-accent/50"
                              >
                                <td className="min-w-0 truncate p-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openExternally(
                                        workitemUrl(selected.id, w.id),
                                      )
                                    }
                                    className="block w-full cursor-pointer truncate px-3 py-1.5 text-left"
                                  >
                                    <span className="text-muted-foreground/60">
                                      {w.serialNumber
                                        ? `#${w.serialNumber} `
                                        : ""}
                                    </span>
                                    {w.subject}
                                  </button>
                                </td>
                                <td className="px-2 py-1">
                                  {editable ? (
                                    <select
                                      value={w.statusId}
                                      onChange={(e) => {
                                        const opt = e.target.selectedOptions[0];
                                        patchItem(
                                          w.id,
                                          {
                                            statusId: e.target.value,
                                            statusName: opt?.dataset.name ?? "",
                                          },
                                          { status: e.target.value },
                                        );
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className={cn(
                                        "h-6 cursor-pointer rounded px-1.5 text-[11px] outline-none",
                                        statusColorClass(w.statusName),
                                      )}
                                    >
                                      {!active.items.some(
                                        (x) => x.statusId === w.statusId,
                                      ) && (
                                        <option value={w.statusId}>
                                          {w.statusName}
                                        </option>
                                      )}
                                      {Array.from(
                                        new Map(
                                          active.items.map((x) => [
                                            x.statusId,
                                            x.statusName,
                                          ]),
                                        ),
                                      ).map(([id, name]) => (
                                        <option
                                          key={id}
                                          value={id}
                                          data-name={name}
                                        >
                                          {name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span
                                      className={cn(
                                        "inline-block rounded px-1.5 py-0.5 text-[11px]",
                                        statusColorClass(w.statusName),
                                      )}
                                    >
                                      {w.statusName}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-muted-foreground">
                                  {editable ? (
                                    pickingAssignee === w.id ? (
                                      <MemberPicker
                                        members={members}
                                        onCancel={() =>
                                          setPickingAssignee(null)
                                        }
                                        onPick={(m) => {
                                          setPickingAssignee(null);
                                          patchItem(
                                            w.id,
                                            {
                                              assignedToId: m.userId,
                                              assignedTo: m.name,
                                            },
                                            { assignedTo: m.userId },
                                          );
                                        }}
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        title="双击修改"
                                        onDoubleClick={() =>
                                          setPickingAssignee(w.id)
                                        }
                                        className="block h-6 w-full cursor-pointer truncate rounded px-1 text-left text-[11px] hover:bg-foreground/10"
                                      >
                                        {w.assignedTo}
                                      </button>
                                    )
                                  ) : (
                                    w.assignedTo
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-muted-foreground">
                                  {w.creator}
                                </td>
                                <td className="px-2 py-1 text-muted-foreground tabular-nums">
                                  <EditableCell
                                    editable={editable && !!w.startDateFieldId}
                                    display={toDateInputValue(w.startDate)}
                                    editValue={toDateInputValue(w.startDate)}
                                    type="date"
                                    onCommit={(v) =>
                                      patchItem(
                                        w.id,
                                        { startDate: `${v} 00:00:00` },
                                        {
                                          [w.startDateFieldId]: `${v} 00:00:00`,
                                        },
                                      )
                                    }
                                  />
                                </td>
                                <td className="px-2 py-1 text-muted-foreground tabular-nums">
                                  <EditableCell
                                    editable={editable && !!w.dueDateFieldId}
                                    display={toDateInputValue(w.dueDate)}
                                    editValue={toDateInputValue(w.dueDate)}
                                    type="date"
                                    onCommit={(v) =>
                                      patchItem(
                                        w.id,
                                        { dueDate: `${v} 23:59:59` },
                                        { [w.dueDateFieldId]: `${v} 23:59:59` },
                                      )
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                    <span>共 {active.total} 条</span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={active.loading || active.page <= 1}
                        onClick={() =>
                          selected &&
                          loadCategory(selected.id, category, active.page - 1)
                        }
                        className="h-6 px-1.5"
                      >
                        <HugeiconsIcon
                          icon={ArrowLeft01Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                      </Button>
                      <span className="tabular-nums">
                        {active.page} / {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={active.loading || active.page >= totalPages}
                        onClick={() =>
                          selected &&
                          loadCategory(selected.id, category, active.page + 1)
                        }
                        className="h-6 px-1.5"
                      >
                        <HugeiconsIcon
                          icon={ArrowRight01Icon}
                          size={13}
                          strokeWidth={1.75}
                        />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
