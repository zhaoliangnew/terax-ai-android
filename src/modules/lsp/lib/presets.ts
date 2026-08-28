import { native } from "@/modules/ai/lib/native";
import type { LspCustomServer } from "@/modules/settings/store";

export type LspPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** languageResolver id -> LSP languageId */
  languages: Record<string, string>;
  rootMarkers: string[];
  initializationOptions?: unknown;
  env?: Record<string, string>;
  /**
   * 启动前现算的环境变量,和 `env` 合并(这个优先)。
   *
   * 有些服务器对运行时有硬要求,而那个运行时的位置每台机器不一样,写死没用。
   */
  resolveEnv?: () => Promise<Record<string, string>>;
  maxMemoryMb?: number;
  /** Absent for user-defined servers. */
  install?: { command: string; docsUrl: string };
};

/**
 * 找一个 21 以上的 JDK 交给 jdtls / kotlin-language-server。
 *
 * 这两个服务器自己要跑在 JDK 21+ 上,跟工程用哪个 JDK 编译没关系。而安卓开发机
 * 的 `~/.zshrc` 里常年把 JAVA_HOME 钉在 17(Gradle 要),服务器继承过来就直接
 * "requires at least Java 21" 退出。
 *
 * 生成的 JAVA_HOME 会盖掉登录 shell 那份 —— 后端 spawn 的顺序是"登录环境 →
 * 预置 env",后者赢。找不到 21+ 就返回空,维持原样。
 */
async function javaHome21Plus(): Promise<Record<string, string>> {
  // java_home 是 macOS 独有的;别的平台就按机器上的 JAVA_HOME/PATH 来
  if (
    typeof navigator === "undefined" ||
    !/Mac|iPhone|iPad/.test(navigator.platform)
  ) {
    return {};
  }
  try {
    const out = await native.runCommand(
      "/usr/libexec/java_home -v 21+",
      null,
      10,
    );
    const home = out.stdout.trim();
    return home ? { JAVA_HOME: home } : {};
  } catch {
    return {};
  }
}

export const LSP_PRESETS: LspPreset[] = [
  {
    id: "typescript",
    name: "TypeScript",
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
    },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    initializationOptions: { maxTsServerMemory: 3072 },
    install: {
      command: "npm install -g typescript-language-server typescript",
      docsUrl:
        "https://github.com/typescript-language-server/typescript-language-server",
    },
  },
  {
    id: "rust-analyzer",
    name: "Rust",
    command: "rust-analyzer",
    args: [],
    languages: { rs: "rust" },
    rootMarkers: ["Cargo.toml"],
    // Measured: default profile settles at ~3 GB resident, this one at ~1 GB,
    // trading analysis inside proc macros and cargo-check diagnostics.
    initializationOptions: {
      cachePriming: { enable: false },
      lru: { capacity: 32 },
      checkOnSave: false,
      procMacro: { enable: false },
      cargo: { buildScripts: { enable: false } },
      diagnostics: {
        disabled: ["unresolved-proc-macro", "unresolved-macro-call"],
      },
    },
    env: { CARGO_BUILD_JOBS: "2" },
    maxMemoryMb: 3072,
    install: {
      command: "rustup component add rust-analyzer",
      docsUrl: "https://rust-analyzer.github.io/book/installation.html",
    },
  },
  {
    id: "pyright",
    name: "Python",
    command: "pyright-langserver",
    args: ["--stdio"],
    languages: { py: "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    install: {
      command: "npm install -g pyright",
      docsUrl: "https://microsoft.github.io/pyright/#/installation",
    },
  },
  {
    id: "ruff",
    name: "Ruff",
    command: "ruff",
    args: ["server"],
    languages: { py: "python" },
    rootMarkers: [
      "pyproject.toml",
      "ruff.toml",
      ".ruff.toml",
      "setup.py",
      "requirements.txt",
    ],
    install: {
      command: "pip install ruff",
      docsUrl: "https://docs.astral.sh/ruff/editors/",
    },
  },
  {
    id: "gopls",
    name: "Go",
    command: "gopls",
    args: [],
    languages: { go: "go" },
    rootMarkers: ["go.mod", "go.work"],
    install: {
      command: "go install golang.org/x/tools/gopls@latest",
      docsUrl: "https://pkg.go.dev/golang.org/x/tools/gopls#section-readme",
    },
  },
  {
    id: "clangd",
    name: "C/C++",
    command: "clangd",
    args: [],
    languages: { c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp" },
    rootMarkers: [
      "compile_commands.json",
      "CMakeLists.txt",
      "Makefile",
      ".clangd",
    ],
    install: {
      command: "brew install llvm",
      docsUrl: "https://clangd.llvm.org/installation",
    },
  },
  {
    id: "zls",
    name: "Zig",
    command: "zls",
    args: [],
    languages: { zig: "zig" },
    rootMarkers: ["build.zig"],
    install: {
      command: "brew install zls",
      docsUrl: "https://zigtools.org/zls/install/",
    },
  },
  {
    id: "lua-ls",
    name: "Lua",
    command: "lua-language-server",
    args: [],
    languages: { lua: "lua" },
    rootMarkers: [".luarc.json", ".luarc.jsonc"],
    install: {
      command: "brew install lua-language-server",
      docsUrl: "https://luals.github.io/#install",
    },
  },
  {
    id: "ruby-lsp",
    name: "Ruby",
    command: "ruby-lsp",
    args: [],
    languages: { rb: "ruby" },
    rootMarkers: ["Gemfile"],
    install: {
      command: "gem install ruby-lsp",
      docsUrl: "https://shopify.github.io/ruby-lsp/",
    },
  },
  {
    id: "intelephense",
    name: "PHP",
    command: "intelephense",
    args: ["--stdio"],
    languages: { php: "php" },
    rootMarkers: ["composer.json"],
    install: {
      command: "npm install -g intelephense",
      docsUrl: "https://intelephense.com",
    },
  },
  {
    id: "jdtls",
    name: "Java",
    // eclipse.jdt.ls 的启动脚本,brew 装完就叫这个名字,自己走 stdio
    command: "jdtls",
    args: [],
    resolveEnv: javaHome21Plus,
    languages: { java: "java" },
    rootMarkers: [
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "pom.xml",
      ".git",
    ],
    // 安卓工程动辄几千个类,给足堆;不给的话索引到一半 OOM 退出
    maxMemoryMb: 4096,
    install: {
      // jdtls 要 21+ 才跑得起来,一起装上
      command: "brew install jdtls openjdk@21",
      docsUrl: "https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    },
  },
  {
    id: "kotlin-ls",
    name: "Kotlin",
    command: "kotlin-language-server",
    args: [],
    // 和 jdtls 同一个坑:它也得跑在 21+ 上,而机器上的 JAVA_HOME 多半钉在 17
    resolveEnv: javaHome21Plus,
    languages: { kt: "kotlin", kts: "kotlin" },
    rootMarkers: [
      "build.gradle.kts",
      "build.gradle",
      "settings.gradle",
      ".git",
    ],
    maxMemoryMb: 3072,
    install: {
      command: "brew install kotlin-language-server",
      docsUrl: "https://github.com/fwcd/kotlin-language-server",
    },
  },
  {
    id: "yaml-ls",
    name: "YAML",
    command: "yaml-language-server",
    args: ["--stdio"],
    languages: { yaml: "yaml", yml: "yaml" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g yaml-language-server",
      docsUrl: "https://github.com/redhat-developer/yaml-language-server",
    },
  },
  {
    id: "bash-ls",
    name: "Shell",
    command: "bash-language-server",
    args: ["start"],
    languages: { sh: "shellscript", bash: "shellscript", zsh: "shellscript" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g bash-language-server",
      docsUrl: "https://github.com/bash-lsp/bash-language-server",
    },
  },
  {
    id: "json-ls",
    name: "JSON",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    languages: { json: "json" },
    rootMarkers: [".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "css-ls",
    name: "CSS",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    languages: { css: "css", scss: "scss", less: "less" },
    rootMarkers: ["package.json", ".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "html-ls",
    name: "HTML",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    languages: { html: "html" },
    rootMarkers: ["package.json", ".git"],
    install: {
      command: "npm install -g vscode-langservers-extracted",
      docsUrl: "https://github.com/hrsh7th/vscode-langservers-extracted",
    },
  },
  {
    id: "svelte-ls",
    name: "Svelte",
    command: "svelteserver",
    args: ["--stdio"],
    languages: { svelte: "svelte" },
    rootMarkers: ["svelte.config.js", "package.json"],
    install: {
      command: "npm install -g svelte-language-server",
      docsUrl: "https://github.com/sveltejs/language-tools",
    },
  },
  {
    id: "vue-ls",
    name: "Vue",
    command: "vue-language-server",
    args: ["--stdio"],
    languages: { vue: "vue" },
    rootMarkers: ["vite.config.ts", "vite.config.js", "package.json"],
    install: {
      command: "npm install -g @vue/language-server",
      docsUrl: "https://github.com/vuejs/language-tools",
    },
  },
  {
    id: "sourcekit",
    name: "Swift",
    command: "sourcekit-lsp",
    args: [],
    languages: { swift: "swift" },
    rootMarkers: ["Package.swift"],
    install: {
      command: "xcode-select --install",
      docsUrl: "https://github.com/swiftlang/sourcekit-lsp",
    },
  },
];

function fromCustom(server: LspCustomServer): LspPreset {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args,
    languages: server.languages,
    rootMarkers: server.rootMarkers,
  };
}

export function allServers(custom: LspCustomServer[]): LspPreset[] {
  return [...LSP_PRESETS, ...custom.map(fromCustom)];
}

export function serversForLanguage(
  langId: string | null,
  custom: LspCustomServer[],
): LspPreset[] {
  if (!langId) return [];
  return allServers(custom).filter((p) => langId in p.languages);
}

// Several presets can claim a language (pyright and ruff both take `py`).
// The enabled one wins; among untouched candidates the first non-dismissed
// is offered by the statusbar hint. Preset order breaks remaining ties.
export function serverForLanguage(
  langId: string | null,
  custom: LspCustomServer[],
  activation?: Record<string, string | undefined>,
): LspPreset | null {
  const candidates = serversForLanguage(langId, custom);
  if (candidates.length === 0) return null;
  if (activation) {
    const enabled = candidates.find((p) => activation[p.id] === "enabled");
    if (enabled) return enabled;
    const fresh = candidates.find((p) => activation[p.id] !== "dismissed");
    if (fresh) return fresh;
  }
  return candidates[0];
}

export function serverById(
  id: string,
  custom: LspCustomServer[],
): LspPreset | null {
  return allServers(custom).find((p) => p.id === id) ?? null;
}
