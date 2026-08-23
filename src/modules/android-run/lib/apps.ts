import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { native } from "@/modules/ai/lib/native";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

export type InstalledApp = { name: string; path: string };

/**
 * 唤起一个本机应用。
 *
 * 走 opener 插件而不是拼 shell:三个平台的命令和引号规则都不一样
 * (`open -a` / `start` / `xdg-open`),Windows 那边 shell 还可能是 cmd 也可能是
 * PowerShell —— 拼字符串迟早出错,交给插件去分发。
 */
export function openApp(path: string): void {
  open(path, "打不开这个应用");
}

/** 在文件管理器里打开一个目录(访达 / 资源管理器 / Files)。 */
export function openFolderInFileManager(path: string): void {
  open(path, "打不开这个目录");
}

/**
 * 失败要说话。
 *
 * 之前写成 `void openPath(path)`,权限没配够时插件返回的 ForbiddenPath 被吞了 ——
 * 表现就是"点了完全没反应",查半天。
 */
function open(path: string, whenFailed: string): void {
  openPath(path).catch((e) => {
    toast.error(whenFailed, { description: `${path} · ${e}` });
  });
}

/** 找不到就返回空数组 —— 目录不存在、没权限,都不该让调用方炸掉。 */
async function names(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const entries = await native.readDir(dir);
    return entries.map((e) => ({ name: e.name, isDir: e.kind === "dir" }));
  } catch {
    return [];
  }
}

/**
 * 本机装了哪些应用。给"收藏应用"挑用的 —— 手敲路径太容易错。
 *
 *  - macOS:/Applications 下的 .app(一个 .app 就是个目录,列一层就够);
 *  - Windows:开始菜单里的快捷方式(.lnk)。系统级和用户级两个根,各往下再看
 *    一层 —— 大多数装机程序要么直接放根下,要么放在一个厂商目录里;
 *  - Linux:/usr/share/applications 下的 .desktop。
 */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  const found: InstalledApp[] = [];

  if (IS_MAC) {
    for (const e of await names("/Applications")) {
      if (e.name.endsWith(".app")) {
        found.push({
          name: e.name.replace(/\.app$/, ""),
          path: `/Applications/${e.name}`,
        });
      }
    }
  } else if (IS_WINDOWS) {
    // 反斜杠统一成正斜杠:后端拼路径两种都认,但字符串里混着 \ 容易看走眼
    const home = (await homeDir()).replace(/\\/g, "/").replace(/\/$/, "");
    const roots = [
      "C:/ProgramData/Microsoft/Windows/Start Menu/Programs",
      `${home}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs`,
    ];
    for (const root of roots) {
      for (const e of await names(root)) {
        if (!e.isDir && e.name.endsWith(".lnk")) {
          found.push({
            name: e.name.replace(/\.lnk$/, ""),
            path: `${root}/${e.name}`,
          });
        } else if (e.isDir) {
          // 只往下再看一层:再深就是卸载程序、说明文档那些噪音了
          for (const sub of await names(`${root}/${e.name}`)) {
            if (!sub.isDir && sub.name.endsWith(".lnk")) {
              found.push({
                name: sub.name.replace(/\.lnk$/, ""),
                path: `${root}/${e.name}/${sub.name}`,
              });
            }
          }
        }
      }
    }
  } else {
    for (const e of await names("/usr/share/applications")) {
      if (e.name.endsWith(".desktop")) {
        found.push({
          name: e.name.replace(/\.desktop$/, ""),
          path: `/usr/share/applications/${e.name}`,
        });
      }
    }
  }

  // 同名去重(Windows 两个开始菜单根经常各有一份),再按名字排
  const seen = new Set<string>();
  return found
    .filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

/**
 * 按名字找一个已装的应用,给"打开微信/钉钉"这种固定入口用。
 *
 * 传几个候选写法(中英文都给上)—— 同一个软件在不同平台、不同版本下装出来的
 * 名字未必一样:macOS 是 WeChat.app,Windows 的开始菜单里是"微信"。
 */
export async function findApp(
  candidates: string[],
): Promise<InstalledApp | null> {
  const apps = await listInstalledApps();
  const lower = candidates.map((c) => c.toLowerCase());
  // 先要完全相等的,没有再退而求其次找包含的,免得"微信开发者工具"抢了"微信"
  for (const want of lower) {
    const exact = apps.find((a) => a.name.toLowerCase() === want);
    if (exact) return exact;
  }
  for (const want of lower) {
    const loose = apps.find((a) => a.name.toLowerCase().includes(want));
    if (loose) return loose;
  }
  return null;
}
