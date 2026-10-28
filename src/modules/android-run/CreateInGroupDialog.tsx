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
import { toPinyin } from "@/lib/pinyin";
import { cn } from "@/lib/utils";
import {
  createGroup,
  createRepository,
  getRootGroupPath,
  listChildNamespaces,
  type CodeupNamespace,
} from "@/modules/android-run/lib/codeupApi";
import {
  relativeGroupPath,
  searchCodeupGroups,
} from "@/modules/android-run/lib/codeupGroupSearch";
import { projectGroupSlug } from "@/modules/android-run/lib/codeupNaming";
import { type InputHTMLAttributes, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ParentGroup = { id: number; relPath: string; name: string };
type Props = {
  parent: ParentGroup | null;
  orgId: string | null;
  token: string | null;
  onClose: () => void;
  onCreated: () => void;
};

function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={props.id}
        className="text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      <input
        {...props}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-8 w-full rounded border border-input bg-transparent px-2 text-[12px] outline-none focus:border-ring"
      />
    </div>
  );
}

function repoSlug(raw: string): string {
  return toPinyin(raw, "_")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
}

export function CreateInGroupDialog({
  parent,
  orgId,
  token,
  onClose,
  onCreated,
}: Props) {
  const [groupMode, setGroupMode] = useState<"existing" | "new">("existing");
  const [selected, setSelected] = useState<ParentGroup | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CodeupNamespace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupPath, setGroupPath] = useState("");
  const [createProduct, setCreateProduct] = useState(true);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdGroup, setCreatedGroup] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    if (!parent) return;
    setSelected(parent);
    setGroupMode("existing");
    setQuery("");
    setResults([]);
    setProjectName("");
    setGroupName("");
    setGroupPath("");
    setCreateProduct(true);
    setName("");
    setPath("");
    setPathTouched(false);
    setDescription("");
    setError("");
    setCreatedGroup("");
  }, [parent]);

  useEffect(() => {
    if (!parent || !orgId || !token || groupMode !== "existing") return;
    let active = true;
    setSearching(true);
    setSearchError("");
    setResults([]);
    const timer = window.setTimeout(() => {
      const request = query.trim()
        ? searchCodeupGroups(
            orgId,
            token,
            query,
            getRootGroupPath() ?? "device2.0",
          )
        : listChildNamespaces(orgId, token, parent.id);
      void request
        .then((groups) => {
          if (active)
            setResults(
              groups.map((g) => ({
                ...g,
                pathWithNamespace: relativeGroupPath(
                  g.pathWithNamespace,
                  orgId,
                ),
              })),
            );
        })
        .catch((e) => {
          if (active) setSearchError(String(e));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [parent, orgId, token, query, groupMode]);

  const generateGroup = (value: string) => {
    const slug = projectGroupSlug(value);
    setGroupName(slug);
    setGroupPath(slug);
  };
  const withProduct = groupMode === "existing" || createProduct;
  const validGroup =
    !!selected &&
    (groupMode === "existing" ||
      (!!projectName.trim() &&
        /^[a-z0-9]+$/.test(groupName) &&
        /^[a-z0-9]+$/.test(groupPath)));
  const validProduct =
    !withProduct ||
    (!!name.trim() &&
      /^[a-z0-9_][a-z0-9_-]*$/.test(path) &&
      !!description.trim());
  const targetPath = selected
    ? `${selected.relPath}${groupMode === "new" ? `/${groupPath || "…"}` : ""}${withProduct ? `/${path || "…"}` : ""}`
    : "尚未选择代码组";

  const submit = async () => {
    if (
      !parent ||
      !selected ||
      !orgId ||
      !token ||
      submitting.current ||
      !validGroup ||
      !validProduct
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    let target = selected;
    let newGroupPath = "";
    try {
      if (groupMode === "new") {
        const group = await createGroup(
          orgId,
          token,
          selected.id,
          groupName,
          groupPath,
          projectName.trim(),
        );
        newGroupPath = `${selected.relPath}/${groupPath}`;
        target = { id: group.id, name: group.name, relPath: newGroupPath };
        setSelected(target);
        setGroupMode("existing");
        setCreatedGroup(newGroupPath);
        onCreated();
      }
      if (withProduct) {
        await createRepository(
          orgId,
          token,
          `${target.relPath}/${path}`,
          "private",
          { name: name.trim(), description: description.trim() },
        );
        toast.success(`产品代码库已创建:${target.relPath}/${path}`);
        onCreated();
      } else toast.success(`代码组已创建:${newGroupPath}`);
      onClose();
    } catch (e) {
      setError(
        `${newGroupPath ? `代码组已创建,代码库创建失败。重试将使用已创建的代码组。` : ""}${String(e)}`,
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={parent !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">新建产品代码库</DialogTitle>
          <DialogDescription className="text-xs">
            选择或新建代码组,在本页完成产品信息填写
          </DialogDescription>
        </DialogHeader>
        <section className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
          <h3 className="text-xs font-medium">代码组</h3>
          <div className="flex gap-2">
            {(
              [
                ["existing", "搜索选择代码组"],
                ["new", "新建代码组"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={groupMode === value ? "secondary" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => {
                  setGroupMode(value);
                  setError("");
                  if (value === "new" && !projectName) {
                    setProjectName(query);
                    generateGroup(query);
                  }
                }}
                className="flex-1 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>
          {groupMode === "existing" ? (
            <>
              <Field
                id="codeup-group-search"
                label="搜索代码组"
                value={query}
                placeholder="输入中文项目名称、拼音或代码组路径"
                disabled={busy}
                onChange={(e) => setQuery(e.target.value)}
              />
              {selected && (
                <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-xs">
                  已选择:{selected.name}
                  <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {selected.relPath}
                  </div>
                </div>
              )}
              <div
                className="max-h-36 overflow-y-auto rounded border border-border/60"
                aria-live="polite"
              >
                {searching ? (
                  <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    正在搜索…
                  </div>
                ) : searchError ? (
                  <div role="alert" className="p-2 text-xs text-destructive">
                    {searchError}
                  </div>
                ) : results.length ? (
                  results.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setSelected({
                          id: g.id,
                          name: g.name,
                          relPath: g.pathWithNamespace,
                        })
                      }
                      className={cn(
                        "block w-full cursor-pointer px-2 py-2 text-left text-xs hover:bg-accent",
                        selected?.id === g.id && "bg-accent",
                      )}
                    >
                      <span>{g.name}</span>
                      {g.description && (
                        <span className="ml-2 text-muted-foreground">
                          {g.description}
                        </span>
                      )}
                      <div className="break-all font-mono text-[11px] text-muted-foreground">
                        {g.pathWithNamespace}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-2 text-xs text-muted-foreground">
                    {query.trim()
                      ? "没有找到匹配的代码组,可在本页选择新建代码组"
                      : "当前组下暂无子代码组,可搜索其他代码组或直接新建"}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="break-all text-[11px] text-muted-foreground">
                新代码组创建在:{selected?.relPath}
              </div>
              <Field
                id="codeup-project-name"
                label="项目名称"
                value={projectName}
                placeholder="例如:南京航空"
                disabled={busy}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (!(e.nativeEvent as InputEvent).isComposing)
                    generateGroup(e.target.value);
                }}
                onCompositionEnd={(e) => generateGroup(e.currentTarget.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  id="codeup-group-name"
                  label="代码组名称"
                  value={groupName}
                  disabled={busy}
                  onChange={(e) => setGroupName(e.target.value)}
                />
                <Field
                  id="codeup-group-path"
                  label="代码组路径"
                  value={groupPath}
                  disabled={busy}
                  onChange={(e) => setGroupPath(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                由项目名称自动生成连续小写拼音,不带下划线;中文项目名称保存在代码组描述中。
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={createProduct}
                  disabled={busy}
                  onChange={(e) => setCreateProduct(e.target.checked)}
                />
                同时创建产品代码库
              </label>
            </>
          )}
        </section>
        {withProduct && (
          <section className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
            <h3 className="text-xs font-medium">产品信息</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="codeup-product-name"
                label="产品名称"
                value={name}
                placeholder="例如:app_bind"
                disabled={busy}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!pathTouched) setPath(repoSlug(e.target.value));
                }}
              />
              <Field
                id="codeup-product-path"
                label="代码库路径"
                value={path}
                disabled={busy}
                onChange={(e) => {
                  setPathTouched(true);
                  setPath(e.target.value);
                }}
              />
            </div>
            <label
              htmlFor="codeup-product-description"
              className="text-[11px] font-medium text-muted-foreground"
            >
              产品描述
            </label>
            <textarea
              id="codeup-product-description"
              rows={2}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full resize-none rounded border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus:border-ring"
            />
          </section>
        )}
        <p className="break-all text-[11px] text-muted-foreground">
          创建路径:{targetPath}
        </p>
        {createdGroup && (
          <p className="text-[11px] text-emerald-500">
            代码组已创建:{createdGroup}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy || !orgId || !token || !validGroup || !validProduct}
            onClick={() => void submit()}
            className="gap-1"
          >
            {busy && <Spinner className="size-3" />}
            {groupMode === "new" && withProduct
              ? "创建代码组及产品"
              : withProduct
                ? "创建产品代码库"
                : "创建代码组"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
