import { native } from "@/modules/ai/lib/native";

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
    candidates: ["/Applications/Sourcetree.app", "/Applications/SourceTree.app"],
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

/**
 * Open `projectRoot` *inside* the tool, not just launch the tool. Passing the
 * path as an argument is what makes Android Studio/IDEA import-or-focus that
 * project, and Sourcetree open that repo's tab.
 */
export async function openInTool(
  appPath: string,
  projectRoot: string,
): Promise<void> {
  await native.shellBgSpawn(`open -a ${q(appPath)} ${q(projectRoot)}`, null);
}

/** Open the project folder itself in Finder. */
export async function openFolder(projectRoot: string): Promise<void> {
  await native.shellBgSpawn(`open ${q(projectRoot)}`, null);
}
