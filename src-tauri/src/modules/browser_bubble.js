// 右栏聊天框最小化后的小圆钮,放进网页右下角(照 Codex)。原生网页压在
// app 界面上面,app 自己画的按钮会被挡住,只能放进页面里。点了用
// terax-annot://chat 通知 app(跳转会被拦下,页面不会走开)。
(() => {
  if (window.__teraxBubble) return;
  const host = document.createElement("div");
  host.style.cssText =
    "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button{all:initial;box-sizing:border-box;width:36px;height:36px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      background:#1f1f1f;color:#e8e8e8;border:1px solid rgba(255,255,255,.18);
      box-shadow:0 4px 14px rgba(0,0,0,.35);}
    button:hover{background:#2a2a2a}
    svg{width:17px;height:17px}`;
  const b = document.createElement("button");
  b.title = "打开聊天";
  b.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.9A8.5 8.5 0 1 1 21 11.5z"/></svg>';
  b.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.href = "terax-annot://chat";
    },
    true,
  );
  root.append(style, b);
  (document.body || document.documentElement).appendChild(host);
  window.__teraxBubble = {
    stop() {
      host.remove();
      delete window.__teraxBubble;
    },
  };
})();
