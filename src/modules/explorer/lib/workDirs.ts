import { invoke } from "@tauri-apps/api/core";

/**
 * 工作目录:左栏"项目"旁点 + 选进来的文件夹(个人任务、资料目录这类不在
 * 产品目录里、也不是工程的)。排在项目列表最上面,新加的在前;存本地,
 * 只有手动移出才变。
 */
const KEY = "terax.explorer.workDirs";

/** 列表变了:同一个窗口里可能有好几棵树,都要跟着刷新。 */
export const WORK_DIRS_CHANGED_EVENT = "terax:explorer-workdirs-changed";

function normalize(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

export function loadWorkDirs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 存不下就只影响这次会话
  }
  window.dispatchEvent(new Event(WORK_DIRS_CHANGED_EVENT));
}

/** 加到最前面(已有就挪到最前)。 */
export function addWorkDir(path: string): void {
  const key = normalize(path);
  save([key, ...loadWorkDirs().filter((p) => p !== key)]);
}

export function removeWorkDir(path: string): void {
  const key = normalize(path);
  save(loadWorkDirs().filter((p) => p !== key));
}

/** 弹系统的选文件夹框;取消返回 null。走 dialog 插件的 open 命令。 */
export async function pickFolder(): Promise<string | null> {
  const picked = await invoke<string | string[] | null>("plugin:dialog|open", {
    options: { directory: true, multiple: false, title: "选择工作目录" },
  });
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked ?? null;
}
