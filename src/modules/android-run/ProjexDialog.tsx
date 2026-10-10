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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { pickChatAgent } from "@/modules/agents/lib/chatPrefs";
import {
  isChatTaskOpen,
  reopenChatTask,
  requestChatTask,
} from "@/modules/agents/lib/startChatTask";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type Assignee,
  AssigneeFilter,
  loadAssignee,
  saveAssignee,
} from "./AssigneeFilter";
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
import {
  getWorkitemRepo,
  mainRepoRoot,
  markLaunched,
  setWorkitemRepo,
  type WorkitemRepoBinding,
} from "./lib/workitemBinding";
import {
  ensureTaskWorktree,
  prepareWorkitemLaunch,
} from "./lib/workitemLaunch";
import { resolveProjectLink } from "./lib/yunxiao";
import { ProjexPreview } from "./ProjexPreview";
import { useAndroidRunStore } from "./store";
import { TaskLaunchConfirm } from "./TaskLaunchConfirm";
import { repoName, WorkitemRepoPicker } from "./WorkitemRepoPicker";
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

/**
 * 选仓库 / 确认开工针对的那条工作项。项目在点下去那一刻就记住:
 * 面板只盖住右半边,左边还能换项目,不记住会把绑定写到别的项目下。
 */
type TaskTarget = {
  w: Workitem;
  category: WorkitemCategory;
  project: { id: string; name: string };
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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

/**
 * 行尾的「AI」按钮。单击走开工流程(先确认),右键换仓库;不碰标题的
 * 单击开浏览器和别的格子的双击编辑。
 */
function AiCell({
  binding,
  live,
  done,
  mine,
  onClick,
  onChangeRepo,
}: {
  binding: WorkitemRepoBinding | null;
  /** 这条的会话 tab 还开着。 */
  live: boolean;
  /** 已完成/已取消这类:不用再交给 AI 开发,不给按钮。 */
  done: boolean;
  /** 负责人是不是自己:别人负责的不让交给 AI 开发。 */
  mine: boolean;
  onClick: () => void;
  onChangeRepo: () => void;
}) {
  const title = live
    ? `这条已经在开发了${binding ? `(${binding.worktreePath ?? binding.repoRoot})` : ""},点击切到它的会话`
    : binding
      ? `${binding.repoRoot}${binding.worktreePath ? `\nworktree:${binding.worktreePath}` : ""}\n点击确认后开始开发;右键换仓库`
      : "选一个本地仓库,让 AI 开发这条(右键也能选)";
  if ((done || !mine) && !live)
    return (
      <span
        title={done ? "已经做完/不做了" : "不是你负责的"}
        className="block text-center text-[12px] text-muted-foreground/50"
      >
        —
      </span>
    );
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onChangeRepo();
      }}
      className={cn(
        "block h-6 w-full cursor-pointer truncate rounded-md px-2 text-center text-[12px] font-medium transition-colors",
        live
          ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
          : binding
            ? "bg-[#2c67c5]/20 text-[#7aa8f5] hover:bg-[#2c67c5]/30"
            : "border border-[#2c67c5]/60 text-[#7aa8f5] hover:bg-[#2c67c5]/20",
      )}
    >
      {live
        ? "打开会话"
        : binding
          ? `▶ ${repoName(binding.repoRoot)}`
          : "AI 开发"}
    </button>
  );
}

/** 已经做完/不做了的状态:开发完成、已完成、已提测、已取消、关闭…… */
function isDoneStatus(name: string): boolean {
  return /完成|取消|关闭|废弃|提测|验收|上线/.test(name);
}

/** 状态名没有固定枚举(不同项目模板不一样),按关键字给个颜色分组。 */
function statusColorClass(name: string): string {
  if (
    name === "已完成" ||
    name.includes("取消") ||
    name.includes("关闭") ||
    name.includes("废弃")
  ) {
    return "bg-foreground/10 text-muted-foreground";
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
  // 只看某个人负责的(交给服务端过滤,几千条不可能拉回来本地筛);null = 全部。
  // 选择记在本地,下次打开还是这个人
  const [assignee, setAssigneeState] = useState<Assignee | null>(() =>
    loadAssignee(),
  );
  const setAssignee = (a: Assignee | null) => {
    saveAssignee(a);
    setAssigneeState(a);
  };
  // 浮层里预览的网页(工作项、视图、项目):原生 webview,和右栏内置浏览器
  // 同一套,登录态共用,不用跳系统浏览器
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(
    null,
  );
  // 最后点开看的那一行:高亮,对得上右边预览的是哪条
  const [activeRow, setActiveRow] = useState<string | null>(null);
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

  // 工作项 → 仓库的绑定存在 localStorage,改完靠这个计数器让 effect 重读
  const [bindVersion, setBindVersion] = useState(0);
  const [bindings, setBindings] = useState<Record<string, WorkitemRepoBinding>>(
    {},
  );
  // 会话 tab 还开着的工作项,按钮显示「打开」
  const [liveTasks, setLiveTasks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 正在选仓库;thenConfirm = 选完接着弹确认(首次点),右键换仓库不接
  const [picking, setPicking] = useState<
    (TaskTarget & { thenConfirm: boolean }) | null
  >(null);
  const [confirming, setConfirming] = useState<
    (TaskTarget & { repoRoot: string }) | null
  >(null);
  // 开工进行到哪一步(建 worktree… / 拉需求…)
  const [launchStep, setLaunchStep] = useState<string | null>(null);
  // 每次开工/取消都 +1;await 回来发现对不上就说明被取消了,别再开 tab
  const launchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setToken(getYunxiaoToken());
    setOrgId(getCodeupOrgId());
    setViews(getWorkitemViews());
    setEditingView(null);
  }, [open]);

  // 浮层一关,没走完的开工就作废,选仓库/确认面板也收起
  useEffect(() => {
    if (open) return;
    launchSeq.current++;
    setLaunchStep(null);
    setPicking(null);
    setConfirming(null);
  }, [open]);

  // 还没选项目时,按当前工程(worktree 换算回主仓库)所在产品目录绑的
  // 云效项目预选,省得每次在几百个项目里搜
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在打开那一下预选,用户手选的不覆盖
  useEffect(() => {
    if (!open || selected) return;
    const root = useAndroidRunStore.getState().projectRoot;
    if (!root) return;
    const hit = resolveProjectLink(mainRepoRoot(root));
    if (!hit) return;
    setSelected({
      id: hit.link.id,
      name: hit.link.name,
      description: "",
      statusName: "",
    });
  }, [open]);

  // 绑定和"会话还开着"都是副作用读,不能在渲染期算(React Compiler 会
  // 记忆化,改绑之后还显示旧仓库,见 ProductLinkChip)
  // biome-ignore lint/correctness/useExhaustiveDependencies: bindVersion 是绑定变更信号
  useEffect(() => {
    if (!open) return;
    const next: Record<string, WorkitemRepoBinding> = {};
    const live = new Set<string>();
    for (const w of [...cats.Req.items, ...cats.Task.items]) {
      const b = getWorkitemRepo(w.id);
      if (b) next[w.id] = b;
      if (isChatTaskOpen(w.id)) live.add(w.id);
    }
    setBindings(next);
    setLiveTasks(live);
  }, [open, cats, bindVersion]);

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
    searchWorkitems(orgId, token, projectId, cat, page, PER_PAGE, assignee?.id)
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

  // 选中项目/换负责人时:两种类型都从第一页重拉,切 tab 就不用等了
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadCategory 的依赖都已列出
  useEffect(() => {
    if (!selected) return;
    loadCategory(selected.id, "Req", 1);
    loadCategory(selected.id, "Task", 1);
  }, [selected, token, orgId, assignee?.id]);

  // 浮层关了就收掉预览:原生网页跟着卸载关掉,下次打开回到列表
  useEffect(() => {
    if (!open) setPreview(null);
  }, [open]);

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

  const targetOf = (w: Workitem): TaskTarget | null =>
    selected
      ? { w, category, project: { id: selected.id, name: selected.name } }
      : null;

  /** 行尾「AI」按钮:会话开着就切过去;没绑仓库先选;否则弹确认。 */
  const onAiClick = (w: Workitem) => {
    // 同一条任务不重复开、不重发,tab 还在就直接切过去;当初没启动起来的
    // 顺手重来一次(只切过去的话只能对着一个死会话)
    const reopened = reopenChatTask(w.id);
    if (reopened) {
      toast.info(
        reopened === "retried"
          ? "这条任务上次没启动起来,已经重新开工"
          : "这条任务已经在开发了",
        {
          description: [w.serialNumber, w.subject].filter(Boolean).join(" "),
        },
      );
      onOpenChange(false);
      return;
    }
    const t = targetOf(w);
    if (!t) return;
    // 按钮上的「打开」可能已经过时(tab 被关了),顺手刷新一下
    setBindVersion((v) => v + 1);
    const b = getWorkitemRepo(w.id);
    if (b) setConfirming({ ...t, repoRoot: b.repoRoot });
    else setPicking({ ...t, thenConfirm: true });
  };

  const onPickRepo = (path: string) => {
    if (!picking) return;
    const { thenConfirm, ...t } = picking;
    // 绑的永远是主仓库;worktree 是开工时按需建的,不能当绑定
    const repoRoot = mainRepoRoot(path);
    const prev = getWorkitemRepo(t.w.id);
    setWorkitemRepo(t.w.id, {
      repoRoot,
      serialNumber: t.w.serialNumber,
      subject: t.w.subject,
      projectId: t.project.id,
      category: t.category,
      boundAt: Date.now(),
      // 还是同一个仓库就留着上次开工的记录;换了仓库,旧 worktree 不算数
      ...(prev?.repoRoot === repoRoot
        ? { launchedAt: prev.launchedAt, worktreePath: prev.worktreePath }
        : {}),
    });
    setBindVersion((v) => v + 1);
    setPicking(null);
    if (thenConfirm) setConfirming({ ...t, repoRoot });
  };

  const onUnbindRepo = () => {
    if (!picking) return;
    setWorkitemRepo(picking.w.id, null);
    setBindVersion((v) => v + 1);
    setPicking(null);
    // 从确认面板点进来的:仓库都解绑了,底下那个确认面板也不能再开工
    if (confirming?.w.id === picking.w.id) cancelLaunch();
  };

  const cancelLaunch = () => {
    launchSeq.current++;
    setLaunchStep(null);
    setConfirming(null);
  };

  /**
   * 用户在确认面板点了「开始开发」才真正动手:按选择建/复用 worktree,
   * 拉需求正文拼第一条消息,交给 App 开新 tab 发出去。任何一步失败都停在
   * 确认面板上,让用户换个选择再来。
   */
  const startLaunch = async (useWorktree: boolean) => {
    if (!confirming || !orgId || !token) return;
    const { w, project, repoRoot } = confirming;
    const seq = ++launchSeq.current;
    const stale = () => seq !== launchSeq.current;

    let devDir = repoRoot;
    let worktreePath: string | undefined;
    if (useWorktree) {
      setLaunchStep("建 worktree…");
      try {
        const wt = await ensureTaskWorktree(
          repoRoot,
          w.serialNumber,
          w.subject,
        );
        devDir = wt.path;
        worktreePath = wt.path;
      } catch (e) {
        if (stale()) return;
        setLaunchStep(null);
        toast.error(errText(e));
        return;
      }
      if (stale()) return;
    }

    setLaunchStep("拉需求…");
    const agent = pickChatAgent(devDir);
    let launch: Awaited<ReturnType<typeof prepareWorkitemLaunch>>;
    try {
      launch = await prepareWorkitemLaunch({
        orgId,
        token,
        item: w,
        project,
        devDir,
        worktree: useWorktree,
        agent,
      });
    } catch (e) {
      if (stale()) return;
      setLaunchStep(null);
      toast.error(`拉需求失败:${errText(e)}`);
      return;
    }
    if (stale()) return;

    if (launch.degraded) {
      toast.info("没拿到需求描述(云效上没写或没拉下来),只发了标题和链接");
    }
    requestChatTask({
      key: w.id,
      dir: devDir,
      title: launch.title,
      prompt: launch.prompt,
      url: launch.url,
      agent,
    });
    markLaunched(w.id, worktreePath);
    setBindVersion((v) => v + 1);
    setLaunchStep(null);
    setConfirming(null);
    onOpenChange(false);
  };

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        backdrop
        side="right"
        align="start"
        collisionPadding={8}
        // 新建/编辑视图是个套在里面的 Dialog,它渲染在 portal 里,
        // 点它会被当成"点了外面"把浮层关掉 —— 编辑期间不让关
        // 开工进行中也不让点外面关:要停就点面板里的「取消」
        onInteractOutside={(e) => {
          if (editingView !== null || launchStep !== null) e.preventDefault();
        }}
        // Radix 在 document 捕获阶段就处理 Esc,输入框里 stopPropagation
        // 拦不住;叠着的面板开着时 Esc 只收面板,不关整个浮层
        onEscapeKeyDown={(e) => {
          // 输入法组字时的 Esc 是取消组字,不是关面板
          if (e.isComposing || e.keyCode === 229) {
            e.preventDefault();
            return;
          }
          if (!picking && !confirming) {
            // 开着预览:Esc 先回到列表,再按一次才关浮层
            if (preview) {
              e.preventDefault();
              setPreview(null);
            }
            return;
          }
          e.preventDefault();
          // 从确认面板点「换仓库」叠上来的选仓库面板:只收它,确认面板还在
          if (picking) setPicking(null);
          else cancelLaunch();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // 要在里面直接看云效网页(需求正文、看板),给大一点,窗口小就贴着边
        // 一打开就铺满窗口:开预览时不再变大跳一下,列表也有地方摆全
        className="flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] w-[calc(100vw-5rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 p-0"
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
            <AssigneeFilter
              members={members}
              self={self}
              value={assignee}
              onChange={setAssignee}
            />
          </div>
          <div className="flex min-w-0 flex-1 justify-center px-2">
            {selected && orgId && (
              <button
                type="button"
                title="在浮层里打开这个项目的云效页面"
                onClick={() =>
                  setPreview({
                    title: selected.name,
                    url: projexUrl(orgId, selected.id),
                  })
                }
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
                      onClick={() => setPreview({ title: v.name, url: v.url })}
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
              {/* 选中的项目就在列表原位高亮,不挪位置(挪了列表会跳);只有它不在
                  当前列表里(搜索没搜到它)才钉在搜索框下面 */}
              {selected &&
                !filteredProjects.some((p) => p.id === selected.id) && (
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
                  filteredProjects.map((p) => (
                    <button
                      key={p.id || p.name}
                      type="button"
                      onClick={() => setSelected(p)}
                      title={p.description || p.name}
                      // 项目名长(XXX部队-哈密机场--XMBM…):换行显示全,不截断
                      className={cn(
                        "flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-[12.5px] leading-snug transition-colors",
                        p.id === selected?.id
                          ? "bg-emerald-500/15 font-medium text-emerald-400"
                          : "hover:bg-accent/70",
                      )}
                    >
                      <span className="min-w-0 flex-1 break-all">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <ResizablePanelGroup
              orientation="horizontal"
              className="min-w-0 flex-1"
            >
              <ResizablePanel
                id="projex-list"
                defaultSize="52%"
                minSize={preview ? "280px" : 0}
              >
                <div className="relative flex h-full min-h-0 min-w-0 flex-col">
                  {picking && (
                    <WorkitemRepoPicker
                      projectId={picking.project.id}
                      label={`${picking.w.serialNumber ? `#${picking.w.serialNumber} ` : ""}${picking.w.subject}`}
                      current={bindings[picking.w.id]?.repoRoot ?? null}
                      onPick={onPickRepo}
                      onUnbind={onUnbindRepo}
                      onCancel={() => setPicking(null)}
                    />
                  )}
                  {confirming && !picking && (
                    <TaskLaunchConfirm
                      // 换了工作项或仓库就重新探测、重置选项,别带着上一条的选择
                      key={`${confirming.w.id}\n${confirming.repoRoot}`}
                      item={confirming.w}
                      repoRoot={confirming.repoRoot}
                      busy={launchStep}
                      onCancel={cancelLaunch}
                      // 确认面板留着(选仓库面板盖着时不渲染):换仓库时取消/Esc
                      // 还回到它,选了新仓库就换成新仓库的确认
                      onChangeRepo={() => {
                        setPicking({
                          w: confirming.w,
                          category: confirming.category,
                          project: confirming.project,
                          thenConfirm: true,
                        });
                      }}
                      onStart={startLaunch}
                    />
                  )}
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
                              {cats[c.value].loading
                                ? "…"
                                : cats[c.value].total}
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
                          <table className="w-full min-w-[48rem] table-fixed border-collapse text-[13px] text-foreground/85">
                            <thead className="sticky top-0 bg-card/95 text-[12px] text-muted-foreground backdrop-blur">
                              <tr className="border-b border-border/60">
                                <th className="min-w-40 px-3 py-1.5 text-left font-medium">
                                  标题
                                </th>
                                <th className="w-24 px-3 py-1.5 text-left font-medium">
                                  状态
                                </th>
                                <th className="w-16 px-2 py-1.5 text-left font-medium">
                                  负责人
                                </th>
                                <th className="w-16 px-2 py-1.5 text-left font-medium">
                                  创建者
                                </th>
                                <th className="w-24 px-2 py-1.5 text-left font-medium whitespace-nowrap">
                                  计划开始
                                </th>
                                <th className="w-24 px-2 py-1.5 text-left font-medium whitespace-nowrap">
                                  计划完成
                                </th>
                                <th
                                  className="w-28 px-3 py-1.5 text-center font-medium"
                                  title="让 AI 在本地仓库里开发这条(右键换仓库)"
                                >
                                  AI
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {active.items.map((w) => {
                                const editable = canEdit(w);
                                return (
                                  <tr
                                    key={w.id}
                                    // 正在右边预览的那一行标出来,对得上看的是哪条
                                    className={cn(
                                      "border-b border-border/40 transition-colors hover:bg-accent/50",
                                      activeRow === w.id &&
                                        // 和左边选中的项目同一个绿:字也变绿,一眼认出来
                                        "bg-emerald-500/15 shadow-[inset_3px_0_0_#34d399] hover:bg-emerald-500/20 [&_td]:!text-emerald-400 [&_td>button]:!text-emerald-400 [&_td>button_span]:!text-emerald-400/70",
                                    )}
                                  >
                                    <td className="min-w-0 p-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveRow(w.id);
                                          setPreview({
                                            title: `${w.serialNumber ? `#${w.serialNumber} ` : ""}${w.subject}`,
                                            url: workitemUrl(
                                              selected.id,
                                              w.id,
                                              category,
                                            ),
                                          });
                                        }}
                                        // 标题最多两行,不截成"9月补录:腾云决策类型…"
                                        className="line-clamp-2 w-full cursor-pointer px-3 py-1.5 text-left leading-snug font-medium text-foreground"
                                      >
                                        <span className="text-muted-foreground">
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
                                            const opt =
                                              e.target.selectedOptions[0];
                                            patchItem(
                                              w.id,
                                              {
                                                statusId: e.target.value,
                                                statusName:
                                                  opt?.dataset.name ?? "",
                                              },
                                              { status: e.target.value },
                                            );
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className={cn(
                                            "h-6 cursor-pointer rounded px-1.5 text-[12px] outline-none",
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
                                            "inline-block rounded px-1.5 py-0.5 text-[12px]",
                                            statusColorClass(w.statusName),
                                          )}
                                        >
                                          {w.statusName}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-foreground/75">
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
                                            className="block h-6 w-full cursor-pointer truncate rounded px-1 text-left text-[12.5px] hover:bg-foreground/10"
                                          >
                                            {w.assignedTo}
                                          </button>
                                        )
                                      ) : (
                                        w.assignedTo
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-foreground/75">
                                      {w.creator}
                                    </td>
                                    <td className="px-2 py-1.5 text-foreground/75 tabular-nums">
                                      <EditableCell
                                        editable={
                                          editable && !!w.startDateFieldId
                                        }
                                        display={toDateInputValue(w.startDate)}
                                        editValue={toDateInputValue(
                                          w.startDate,
                                        )}
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
                                    <td className="px-2 py-1.5 text-foreground/75 tabular-nums">
                                      <EditableCell
                                        editable={
                                          editable && !!w.dueDateFieldId
                                        }
                                        display={toDateInputValue(w.dueDate)}
                                        editValue={toDateInputValue(w.dueDate)}
                                        type="date"
                                        onCommit={(v) =>
                                          patchItem(
                                            w.id,
                                            { dueDate: `${v} 23:59:59` },
                                            {
                                              [w.dueDateFieldId]: `${v} 23:59:59`,
                                            },
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="px-2 py-1">
                                      <AiCell
                                        binding={bindings[w.id] ?? null}
                                        live={liveTasks.has(w.id)}
                                        done={isDoneStatus(w.statusName)}
                                        mine={
                                          !!self && w.assignedToId === self.id
                                        }
                                        onClick={() => onAiClick(w)}
                                        onChangeRepo={() => {
                                          const t = targetOf(w);
                                          if (t)
                                            setPicking({
                                              ...t,
                                              thenConfirm: false,
                                            });
                                        }}
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
                              loadCategory(
                                selected.id,
                                category,
                                active.page - 1,
                              )
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
                            disabled={
                              active.loading || active.page >= totalPages
                            }
                            onClick={() =>
                              selected &&
                              loadCategory(
                                selected.id,
                                category,
                                active.page + 1,
                              )
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
              </ResizablePanel>
              {preview && (
                <>
                  <ResizableHandle
                    aria-label="调整列表与详情宽度"
                    className="after:w-5 cursor-col-resize hover:bg-emerald-500/60"
                  />
                  <ResizablePanel
                    id="projex-preview"
                    defaultSize="48%"
                    minSize="360px"
                  >
                    <div className="relative flex h-full min-w-0 flex-col">
                      <ProjexPreview
                        key={preview.url}
                        title={preview.title}
                        url={preview.url}
                        onBack={() => setPreview(null)}
                      />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
