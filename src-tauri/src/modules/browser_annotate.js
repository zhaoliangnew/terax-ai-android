// Injected into an in-app web tab while the user annotates (see browser.rs).
// Styled after Codex: annotated elements keep a blue outline with a numbered
// badge where they were clicked, a comment pill opens next to the element,
// and a dark control bar floats at the bottom of the page.
//
// The page has no IPC, so the script reports by navigating to
// `terax-annot://<sync|send|exit>?d=<json>`, which Rust intercepts (only
// while annotate mode is armed). Everything lives in a closed shadow root and
// is styled through CSSOM, so the page's CSS and CSP can't break it.
(() => {
  if (window.__teraxAnnot) {
    window.__teraxAnnot.start();
    return;
  }

  const BLUE = "#2c67c5";
  const DARK = "#2b2b2b";
  const Z = "2147483647";
  const KEY_EVENTS = [
    "keydown",
    "keypress",
    "keyup",
    "beforeinput",
    "input",
    "compositionstart",
    "compositionupdate",
    "compositionend",
  ];

  let host = null;
  let root = null;
  let hoverBox = null;
  let bar = null;
  let barCount = null;
  let eyeBtn = null;
  let pill = null;
  let pillInput = null;
  let pillCommit = null;
  let active = false;
  let marksShown = true;
  let imeEndedAt = 0;
  /** { el, fx, fy, tag, text, selector, note, box, badge } */
  let items = [];

  const css = (el, style) => Object.assign(el.style, style);

  function report(kind) {
    const payload = items.map((it) => ({
      tag: it.tag,
      text: it.text,
      selector: it.selector,
      note: it.note,
    }));
    const d = encodeURIComponent(
      JSON.stringify({ items: payload, url: location.href, title: document.title }),
    );
    location.href = `terax-annot://${kind}?d=${d}`;
  }

  function selectorOf(el) {
    const parts = [];
    let cur = el;
    for (let i = 0; cur && cur.nodeType === 1 && i < 4; i++) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`${part}#${cur.id}`);
        break;
      }
      const cls = [...cur.classList].find((c) => !/\d{3,}|^css-|^_/.test(c));
      if (cls) part += `.${cls}`;
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function textOf(el) {
    const t =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.value ||
      el.innerText ||
      "";
    return String(t).replace(/\s+/g, " ").trim().slice(0, 80);
  }

  const inUi = (e) => host && e.composedPath().includes(host);

  /** A small inline SVG icon (24x24 viewBox, stroked). */
  function icon(paths) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    for (const d of paths) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    }
    return svg;
  }
  const EYE = [
    "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z",
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ];
  const EYE_OFF = [
    "M3 3l18 18",
    "M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1",
    "M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10.4 10.4 0 0 0 5.4-1.6",
    "M9.9 9.9a3 3 0 0 0 4.2 4.2",
  ];
  const TRASH = [
    "M4 7h16",
    "M10 11v6",
    "M14 11v6",
    "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12",
    "M9 7V4h6v3",
  ];

  function barButton(child, title, onClick) {
    const b = document.createElement("button");
    b.title = title;
    css(b, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "28px",
      height: "28px",
      border: "none",
      borderRadius: "8px",
      background: "transparent",
      color: "rgba(255,255,255,.75)",
      cursor: "pointer",
      padding: "0",
    });
    b.addEventListener("mouseenter", () => css(b, { background: "rgba(255,255,255,.1)" }));
    b.addEventListener("mouseleave", () => css(b, { background: "transparent" }));
    b.addEventListener("click", onClick);
    b.append(child);
    return b;
  }

  // ---- marks: outline around each annotated element + badge at the click

  function makeMark(it, n) {
    it.box = document.createElement("div");
    css(it.box, {
      position: "fixed",
      border: `2px solid ${BLUE}`,
      borderRadius: "3px",
      boxSizing: "border-box",
      pointerEvents: "none",
    });
    it.badge = document.createElement("div");
    css(it.badge, {
      position: "fixed",
      width: "18px",
      height: "18px",
      borderRadius: "9px",
      background: BLUE,
      color: "#fff",
      font: "600 11px/18px system-ui, sans-serif",
      textAlign: "center",
      boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      pointerEvents: "none",
    });
    it.badge.textContent = String(n);
    root.append(it.box, it.badge);
  }

  function layout() {
    if (!root) return;
    items.forEach((it, i) => {
      if (!it.box) makeMark(it, i + 1);
      it.badge.textContent = String(i + 1);
      const r = it.el.getBoundingClientRect();
      const display = marksShown && it.el.isConnected ? "block" : "none";
      css(it.box, {
        display,
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      css(it.badge, {
        display,
        left: `${r.left + r.width * it.fx - 9}px`,
        top: `${r.top + r.height * it.fy - 9}px`,
      });
    });
    if (barCount) barCount.textContent = `批注中 · ${items.length}`;
    if (eyeBtn) {
      eyeBtn.replaceChildren(icon(marksShown ? EYE : EYE_OFF));
      eyeBtn.title = marksShown ? "隐藏批注" : "显示批注";
    }
  }

  function dropMarks() {
    for (const it of items) {
      if (it.box) it.box.remove();
      if (it.badge) it.badge.remove();
      it.box = null;
      it.badge = null;
    }
  }

  // ---- comment pill next to the picked element

  function closePill() {
    if (pill) pill.remove();
    pill = null;
    pillInput = null;
    pillCommit = null;
  }

  function openPill(el, fx, fy) {
    closePill();
    const r = el.getBoundingClientRect();
    pill = document.createElement("div");
    const width = 330;
    const left = Math.min(
      Math.max(r.left + r.width * fx + 14, 8),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(r.top + r.height * fy - 20, 8),
      window.innerHeight - 52,
    );
    css(pill, {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "6px 6px 6px 14px",
      borderRadius: "999px",
      background: DARK,
      boxShadow: "0 6px 24px rgba(0,0,0,.4)",
      font: "13px system-ui, sans-serif",
      pointerEvents: "auto",
    });
    const input = document.createElement("input");
    input.placeholder = "添加评论";
    css(input, {
      flex: "1",
      minWidth: "0",
      background: "transparent",
      border: "none",
      outline: "none",
      color: "#fff",
      font: "13px system-ui, sans-serif",
    });
    const hint = document.createElement("span");
    hint.textContent = "⏎ 添加  ⌘⏎ 发送";
    css(hint, {
      color: "rgba(255,255,255,.45)",
      fontSize: "11px",
      whiteSpace: "nowrap",
    });
    const btn = document.createElement("button");
    btn.textContent = "↑";
    btn.title = "添加";
    css(btn, {
      width: "26px",
      height: "26px",
      flex: "none",
      borderRadius: "13px",
      border: "none",
      background: "rgba(255,255,255,.9)",
      color: DARK,
      cursor: "pointer",
      font: "600 14px system-ui, sans-serif",
    });

    const commit = (send) => {
      const note = input.value.trim();
      closePill();
      if (note) {
        items.push({
          el,
          fx,
          fy,
          tag: el.tagName.toLowerCase(),
          text: textOf(el),
          selector: selectorOf(el),
          note,
          box: null,
          badge: null,
        });
        layout();
      }
      report(send ? "send" : "sync");
    };
    btn.addEventListener("click", () => commit(false));
    pill.append(input, hint, btn);
    root.appendChild(pill);
    pillInput = input;
    pillCommit = commit;
    input.focus();
    // 有的页面点击后自己再抢一次焦点,下一帧再拉回来
    requestAnimationFrame(() => pillInput && pillInput.focus());
  }

  // ---- control bar at the bottom of the page

  function makeBar() {
    bar = document.createElement("div");
    css(bar, {
      position: "fixed",
      left: "50%",
      bottom: "16px",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "5px 6px 5px 14px",
      borderRadius: "12px",
      background: DARK,
      boxShadow: "0 6px 24px rgba(0,0,0,.4)",
      color: "#fff",
      font: "500 13px system-ui, sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "auto",
    });
    barCount = document.createElement("span");
    css(barCount, { marginRight: "6px" });
    eyeBtn = barButton(icon(EYE), "隐藏批注", () => {
      marksShown = !marksShown;
      layout();
    });
    const trash = barButton(icon(TRASH), "清空批注", clear);
    const send = document.createElement("button");
    send.textContent = "发送";
    css(send, {
      height: "28px",
      padding: "0 14px",
      marginLeft: "4px",
      border: "none",
      borderRadius: "8px",
      background: BLUE,
      color: "#fff",
      cursor: "pointer",
      font: "500 13px system-ui, sans-serif",
    });
    send.addEventListener("click", () => report("send"));
    const close = barButton(document.createTextNode("✕"), "退出批注", () =>
      report("exit"),
    );
    bar.append(barCount, eyeBtn, trash, send, close);
    root.appendChild(bar);
  }

  // ---- event handling

  const onMove = (e) => {
    if (!active || pill || inUi(e)) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const r = el.getBoundingClientRect();
    css(hoverBox, {
      display: "block",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  };
  const onClick = (e) => {
    if (!active || inUi(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (pill) {
      closePill();
      return;
    }
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const r = el.getBoundingClientRect();
    const fx = r.width
      ? Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
      : 0;
    const fy = r.height
      ? Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
      : 0;
    hoverBox.style.display = "none";
    openPill(el, fx, fy);
  };
  // Swallow presses too, so the page doesn't act on the pick.
  const onDown = (e) => {
    if (active && !inUi(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // 小框打开时,键盘事件在最外层(window 捕获阶段,比页面任何脚本都早)
  // 就截住:页面收不到,也就没法把字抢到自己的输入框里(百度就会这么干)。
  // 截住只是不传播,字照样进聚焦着的小框;回车、Esc 在这里处理。
  const onKeyGuard = (e) => {
    if (!active || !pill) return;
    if (!inUi(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (pillInput) pillInput.focus();
      return;
    }
    e.stopImmediatePropagation();
    if (e.type === "compositionend") imeEndedAt = performance.now();
    // WebKit 里把拼音直接上屏的那下回车 isComposing 已经是 false,
    // 只能靠 keyCode 229 和"刚结束组字"认出来,别当成"添加"
    if (
      e.type !== "keydown" ||
      e.isComposing ||
      e.keyCode === 229 ||
      performance.now() - imeEndedAt < 50
    ) {
      return;
    }
    if (e.key === "Enter" && pillCommit) {
      e.preventDefault();
      pillCommit(e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePill();
    }
  };
  // 页面脚本想把焦点挪走:拉回小框
  const onFocusGuard = (e) => {
    if (!active || !pill || inUi(e)) return;
    e.stopImmediatePropagation();
    if (pillInput) pillInput.focus();
  };

  function start() {
    if (active) return;
    active = true;
    host = document.createElement("div");
    // Only the pill and the bar take pointer events; the rest is inert.
    css(host, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: Z,
    });
    root = host.attachShadow({ mode: "closed" });
    hoverBox = document.createElement("div");
    css(hoverBox, {
      position: "fixed",
      display: "none",
      border: `2px solid ${BLUE}`,
      background: "rgba(44,103,197,.08)",
      borderRadius: "3px",
      pointerEvents: "none",
      boxSizing: "border-box",
    });
    root.appendChild(hoverBox);
    makeBar();
    document.documentElement.appendChild(host);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", onClick, true);
    for (const t of KEY_EVENTS) window.addEventListener(t, onKeyGuard, true);
    window.addEventListener("focusin", onFocusGuard, true);
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", layout);
    document.documentElement.style.cursor = "crosshair";
    dropMarks();
    layout();
  }

  function stop() {
    active = false;
    closePill();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("click", onClick, true);
    for (const t of KEY_EVENTS) window.removeEventListener(t, onKeyGuard, true);
    window.removeEventListener("focusin", onFocusGuard, true);
    window.removeEventListener("scroll", layout, true);
    window.removeEventListener("resize", layout);
    document.documentElement.style.cursor = "";
    dropMarks();
    if (host) host.remove();
    host = null;
    root = null;
    bar = null;
    barCount = null;
    eyeBtn = null;
  }

  function clear() {
    dropMarks();
    items = [];
    layout();
    report("sync");
  }

  function remove(index) {
    const [it] = items.splice(index, 1);
    if (it) {
      if (it.box) it.box.remove();
      if (it.badge) it.badge.remove();
    }
    layout();
    report("sync");
  }

  window.__teraxAnnot = { start, stop, clear, remove };
  start();
})();
