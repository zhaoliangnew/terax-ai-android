import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { GitStatusSnapshot } from "@/modules/ai/lib/native";
import type { TerminalPathDropTarget } from "@/modules/terminal";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import { FileExplorer } from "./FileExplorer";

// 编辑器整包(CodeMirror + LSP)只在真正打开弹框看文件时才拉进来。
const EditorPane = lazy(() =>
  import("@/modules/editor/EditorPane").then((m) => ({
    default: m.EditorPane,
  })),
);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 工程根目录;null 时不渲染。 */
  rootPath: string | null;
  gitStatus?: GitStatusSnapshot | null;
  dirtyPaths?: Set<string>;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onOpenNewTerminal?: (path: string) => void;
  onOpenInSourceControl?: (path: string) => void;
  onOpenGitHistory?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  pathDropTarget?: TerminalPathDropTarget;
};

/**
 * 产品目录文件:工程自己的文件树 + 右边直接看文件。
 *
 * 以前这棵树是钉在侧栏右半边的,和左边的项目树挤在一起 —— 工程一深
 * (src/main/java/net/xnzn/…)就只剩一条窄缝在看代码。改成单独弹框:
 * 左树右文,文件点开**不进顶部 tab** —— 在这儿翻代码是"看一眼"的事,
 * 每看一个文件都往 tab 栏塞一条,tab 栏很快就没法用了。
 */
export function ProjectFilesDialog({
  open,
  onOpenChange,
  rootPath,
  gitStatus,
  dirtyPaths,
  onPathRenamed,
  onPathDeleted,
  onRevealInTerminal,
  onOpenNewTerminal,
  onOpenInSourceControl,
  onOpenGitHistory,
  onAttachToAgent,
  pathDropTarget,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);

  // 换工程了就别再显示上一个工程的文件
  useEffect(() => {
    setPreview(null);
  }, [rootPath]);

  const explorerProps: Partial<ComponentProps<typeof FileExplorer>> = {
    gitStatus,
    dirtyPaths,
    onPathRenamed,
    onPathDeleted,
    onRevealInTerminal,
    onOpenNewTerminal,
    onOpenInSourceControl,
    onOpenGitHistory,
    onAttachToAgent,
    pathDropTarget,
  };

  const name = rootPath?.split("/").pop() ?? "";

  return (
    <Dialog open={open && !!rootPath} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // 树里的重命名输入框、右键菜单都在 portal 里,自动聚焦会把焦点抢走
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex h-[82vh] w-[76rem] max-w-[calc(100vw-3rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[calc(100vw-3rem)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={14}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground/70"
          />
          <DialogTitle className="shrink-0 text-[12.5px] font-semibold">
            {name}
          </DialogTitle>
          {preview && (
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
              title={preview}
            >
              {rootPath && preview.startsWith(`${rootPath}/`)
                ? preview.slice(rootPath.length + 1)
                : preview}
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 w-[22rem] shrink-0 flex-col border-r border-border/60">
            <FileExplorer
              rootPath={rootPath}
              activeFilePath={preview}
              onOpenFile={(path) => setPreview(path)}
              {...explorerProps}
            />
          </div>
          {/* zoom-content 必须包着编辑器:EditorPane 自带 .zoom-exempt
              (zoom: 1/--app-zoom),在主界面里它抵消的是外层 .zoom-content。
              弹框是 portal 到 body 的,外面没人给它缩放,那个 1/zoom 就白白
              留下 —— 界面缩放不是 100% 时(这儿是 95%),CodeMirror 量出来的
              坐标和鼠标坐标差一个倍数,点哪儿光标都落偏。 */}
          <div className="zoom-content relative min-h-0 min-w-0 flex-1 bg-background">
            {preview ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner className="size-4" />
                  </div>
                }
              >
                {/* key:换文件要整块重建 —— 文档状态是按挂载周期建的 */}
                <EditorPane key={preview} path={preview} />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                左边选一个文件
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
