import "@xterm/xterm/css/xterm.css";
import "./styles/globals.css";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { initLaunchDir } from "./lib/launchDir";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// Reap PTY sessions orphaned by a prior webview load before any tab spawns.
await invoke("pty_close_all").catch(() => {});

// Seed before first paint so default tab mounts at target cwd (no flicker).
await initLaunchDir();

// 界面整个崩掉时别只剩一片空白:把错误直接写在窗口上,截图就能定位
function showFatal(err: unknown) {
  const box = document.createElement("pre");
  box.style.cssText =
    "position:fixed;inset:40px 24px auto;z-index:99999;max-height:80vh;overflow:auto;" +
    "padding:16px;border-radius:8px;background:#2a1215;color:#fca5a5;" +
    "font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;user-select:text";
  const e = err instanceof Error ? err : new Error(String(err));
  box.textContent = `界面出错了(截图发给开发):\n\n${e.message}\n\n${e.stack ?? ""}`;
  document.body.appendChild(box);
}
window.addEventListener("error", (e) => showFatal(e.error ?? e.message));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: (error) => showFatal(error),
}).render(<App />);

// Window starts hidden (per tauri.conf.json) so users never see a transparent
// shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
