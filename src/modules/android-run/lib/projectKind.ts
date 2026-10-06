export type ProjectKind =
  | "android"
  | "flutter"
  | "tauri"
  | "xcode"
  | "maven"
  | "dotnet"
  | "rust"
  | "go"
  | "node"
  | "python"
  | "php"
  | "ruby"
  | "cmake"
  | "idea";

export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  android: "安卓工程",
  flutter: "Flutter 工程",
  tauri: "Tauri 工程",
  xcode: "Xcode 工程",
  maven: "Maven 工程",
  dotnet: ".NET 工程",
  rust: "Rust 工程",
  go: "Go 工程",
  node: "Node 工程",
  python: "Python 工程",
  php: "PHP 工程",
  ruby: "Ruby 工程",
  cmake: "CMake 工程",
  idea: "IDEA 工程",
};

/** 树上工程行的文字标签(安卓用机器人图标,不走这个)。 */
export const PROJECT_KIND_BADGE: Record<ProjectKind, string> = {
  android: "Android",
  flutter: "Flutter",
  tauri: "Tauri",
  xcode: "Xcode",
  maven: "Maven",
  dotnet: ".NET",
  rust: "Rust",
  go: "Go",
  node: "Node",
  python: "Python",
  php: "PHP",
  ruby: "Ruby",
  cmake: "CMake",
  idea: "IDEA",
};

/** 设备栏(投屏/adb/logcat)只对能装到手机上的工程有意义。 */
export function hasDeviceSupport(kind: ProjectKind | null): boolean {
  return kind === "android" || kind === "flutter";
}

// 这些目录本身不可能是工程根,列它们(node_modules 动辄上千项)纯属浪费
const NEVER_PROJECT = new Set([
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "dist",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
]);

export function mayBeProjectDir(path: string): boolean {
  const name =
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  return !NEVER_PROJECT.has(name);
}

export type DirFacts = {
  /** pubspec.yaml 里有 flutter: 段(纯 Dart 包不算)。 */
  flutter: boolean;
  /** .idea/modules.xml 存在。 */
  ideaModules: boolean;
};

/** 需要再读文件才能下结论的标记:没有对应文件就别发那次 IPC。 */
export function factsNeeded(names: ReadonlySet<string>): {
  flutter: boolean;
  ideaModules: boolean;
} {
  return {
    flutter: names.has("pubspec.yaml"),
    ideaModules: names.has(".idea"),
  };
}

const hasSuffix = (names: ReadonlySet<string>, suffixes: string[]) => {
  for (const n of names) {
    if (suffixes.some((s) => n.endsWith(s))) return true;
  }
  return false;
};

/**
 * 按目录里的文件判断工程类型。顺序就是优先级:Flutter 工程里也有
 * android/、Tauri 工程里也有 package.json,得先认更具体的那个;
 * .idea 放最后,任何工程被 IDEA 打开过都会有它。
 */
export function projectKindFromEntries(
  names: ReadonlySet<string>,
  facts: DirFacts,
): ProjectKind | null {
  if (facts.flutter) return "flutter";
  if (names.has("settings.gradle") || names.has("settings.gradle.kts"))
    return "android";
  if (names.has("src-tauri")) return "tauri";
  if (hasSuffix(names, [".xcodeproj", ".xcworkspace"])) return "xcode";
  if (names.has("pom.xml")) return "maven";
  if (hasSuffix(names, [".sln", ".csproj"])) return "dotnet";
  if (names.has("Cargo.toml")) return "rust";
  if (names.has("go.mod")) return "go";
  if (names.has("package.json")) return "node";
  if (
    names.has("pyproject.toml") ||
    names.has("setup.py") ||
    names.has("Pipfile") ||
    names.has("requirements.txt")
  )
    return "python";
  if (names.has("composer.json")) return "php";
  if (names.has("Gemfile")) return "ruby";
  if (names.has("CMakeLists.txt")) return "cmake";
  if (facts.ideaModules) return "idea";
  return null;
}
