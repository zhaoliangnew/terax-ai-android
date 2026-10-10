import { useImeGuard } from "@/lib/ime";
import { cn } from "@/lib/utils";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { branchSearchKey, matchesBranchQuery } from "./lib/branchFilter";
import type { YunxiaoMember } from "./lib/codeupApi";

export type Assignee = { id: string; name: string };

const KEY = "terax.projex.assignee";

/** 上次选的负责人(存本地);没选过是 null = 全部。 */
export function loadAssignee(): Assignee | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.id === "string" && typeof v.name === "string"
      ? { id: v.id, name: v.name }
      : null;
  } catch {
    return null;
  }
}

export function saveAssignee(a: Assignee | null): void {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {}
}

/**
 * 云效浮层顶上的「负责人」筛选:全部 / 我 / 组织里任何人。成员几百号人,
 * 带搜索(拼音首字母也行)。只对当前选中的项目生效:跨项目按人看用云效视图。
 */
export function AssigneeFilter({
  members,
  self,
  value,
  onChange,
}: {
  members: YunxiaoMember[];
  self: { id: string; name: string } | null;
  value: Assignee | null;
  onChange: (a: Assignee | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { imeProps, isImeKey } = useImeGuard();
  const boxRef = useRef<HTMLDivElement>(null);

  // 点外面收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  const keyed = useMemo(
    () => members.map((m) => ({ m, key: branchSearchKey(m.name) })),
    [members],
  );
  const hits = useMemo(() => {
    const list = q.trim()
      ? keyed.filter((k) => matchesBranchQuery(k.key, q)).map((k) => k.m)
      : members;
    return list.filter((m) => m.userId !== self?.id).slice(0, 60);
  }, [keyed, members, q, self]);

  const pick = (a: Assignee | null) => {
    onChange(a);
    setOpen(false);
    setQ("");
  };
  const isMe = !!value && !!self && value.id === self.id;
  const label = !value ? "全部" : isMe ? `我(${value.name})` : value.name;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        title="只看某个人负责的需求/任务(只在当前选中的项目里筛;跨项目按人看用云效视图)"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] transition-colors",
          value
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
            : "border-border/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            value ? "bg-emerald-400" : "bg-muted-foreground/40",
          )}
        />
        负责人:{label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
      </button>
      {open && (
        // role=listbox:浮层里开着网页预览时,原生网页会压在下拉框上面,
        // 内置浏览器认出这类浮层就先把自己藏起来
        <div
          role="listbox"
          aria-label="选负责人"
          className="absolute top-8 left-0 z-50 flex w-60 flex-col rounded-lg border border-border/60 bg-popover p-1 shadow-xl"
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: 点开就是要搜人
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            {...imeProps}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              e.stopPropagation();
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && hits[0])
                pick({ id: hits[0].userId, name: hits[0].name });
            }}
            placeholder="搜成员(拼音首字母也行)"
            spellCheck={false}
            className="mb-1 h-7 rounded-md border border-border bg-transparent px-2 text-[12px] outline-none focus:border-ring"
          />
          <div className="max-h-72 overflow-y-auto">
            {!q.trim() && (
              <>
                <Row active={!value} onClick={() => pick(null)}>
                  全部
                </Row>
                {self && (
                  <Row active={isMe} onClick={() => pick(self)}>
                    我({self.name})
                  </Row>
                )}
                <div className="my-1 border-t border-border/50" />
              </>
            )}
            {hits.length === 0 ? (
              <div className="px-2 py-1.5 text-[11.5px] text-muted-foreground">
                {members.length === 0 ? "正在读取成员…" : "没有匹配的成员"}
              </div>
            ) : (
              hits.map((m) => (
                <Row
                  key={m.userId}
                  active={value?.id === m.userId}
                  onClick={() => pick({ id: m.userId, name: m.name })}
                >
                  {m.name}
                </Row>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-accent/70",
        active ? "text-foreground" : "text-foreground/80",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {active && (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={12}
          strokeWidth={2.25}
          className="shrink-0 text-emerald-500"
        />
      )}
    </button>
  );
}
