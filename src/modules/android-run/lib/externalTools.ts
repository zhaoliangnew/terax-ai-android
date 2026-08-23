import { IS_MAC } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { findApp, openApp, openFolderInFileManager } from "./apps";

/** An external app that can open a project directory, located by .app path. */
export type ExternalTool = {
  id: string;
  name: string;
  /** Candidate bundle paths, first existing one wins. */
  candidates: string[];
};

/** Tools worth offering for an Android/Flutter project root. Ordered by how
 * often they're the one you actually want. */
export const EXTERNAL_TOOLS: ExternalTool[] = [
  {
    id: "android-studio",
    name: "Android Studio",
    candidates: ["/Applications/Android Studio.app"],
  },
  {
    id: "sourcetree",
    name: "Sourcetree",
    candidates: [
      "/Applications/Sourcetree.app",
      "/Applications/SourceTree.app",
    ],
  },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    candidates: ["/Applications/IntelliJ IDEA.app"],
  },
  {
    id: "vscode",
    name: "VS Code",
    candidates: ["/Applications/Visual Studio Code.app"],
  },
  {
    id: "cursor",
    name: "Cursor",
    candidates: ["/Applications/Cursor.app"],
  },
];

/** Shell-quote a path for the `sh -c` string the backend runs. */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Which of the known tools are actually installed, in EXTERNAL_TOOLS order.
 * Probed by listing /Applications once — a .app is just a directory. */
export async function detectTools(): Promise<
  { tool: ExternalTool; appPath: string }[]
> {
  // macOS 直接看 /Applications 里有没有那个 .app —— candidates 里写的就是绝对
  // 路径,一次 readDir 就够。别的平台没有这么个统一目录,改成按名字在已装列表
  // 里找(Windows 是开始菜单的快捷方式)。
  if (IS_MAC) {
    let names: Set<string>;
    try {
      const entries = await native.readDir("/Applications");
      names = new Set(entries.map((e) => e.name));
    } catch {
      return [];
    }
    const found: { tool: ExternalTool; appPath: string }[] = [];
    for (const tool of EXTERNAL_TOOLS) {
      const hit = tool.candidates.find((c) =>
        names.has(c.slice("/Applications/".length)),
      );
      if (hit) found.push({ tool, appPath: hit });
    }
    return found;
  }
  const found: { tool: ExternalTool; appPath: string }[] = [];
  for (const tool of EXTERNAL_TOOLS) {
    const app = await findApp([tool.name]);
    if (app) found.push({ tool, appPath: app.path });
  }
  return found;
}

/**
 * Open `projectRoot` *inside* the tool, not just launch the tool. Passing the
 * path as an argument is what makes Android Studio/IDEA import-or-focus that
 * project, and Sourcetree open that repo's tab.
 */
export async function openInTool(
  appPath: string,
  projectRoot: string,
): Promise<void> {
  // "把工程作为参数传给应用"这件事只有 macOS 的 `open -a` 一条命令就够;
  // 别的平台没有等价写法,退而求其次:先唤起工具,再单独打开工程目录,
  // 让用户自己在工具里选 —— 总比什么都不做强。
  if (IS_MAC) {
    await native.shellBgSpawn(`open -a ${q(appPath)} ${q(projectRoot)}`, null);
    return;
  }
  openApp(appPath);
}

/** 在文件管理器里打开工程目录(访达 / 资源管理器 / Files)。 */
export async function openFolder(projectRoot: string): Promise<void> {
  openFolderInFileManager(projectRoot);
}
