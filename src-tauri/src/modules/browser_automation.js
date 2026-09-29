// Helper the AI tools drive through (see browser_automation.rs). Evaluated
// before every call; defines `window.__teraxAuto` once per document.
//
// snapshot() lists the page's visible interactive elements with numbered refs
// (`[3] button 提交`) plus the page text; click/type/... take those refs.
// Refs are only valid until the next snapshot or navigation.
(() => {
  if (window.__teraxAuto) return;

  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=switch]",
    "[role=textbox]",
    "[role=combobox]",
    "[contenteditable='']",
    "[contenteditable=true]",
    "[onclick]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const MAX_ELEMENTS = 400;

  let refs = new Map();

  const clean = (s, n = 80) =>
    String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }

  function labelOf(el) {
    if (el.labels && el.labels[0]) return el.labels[0].innerText;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const l = document.getElementById(by);
      if (l) return l.innerText;
    }
    return "";
  }

  function nameOf(el) {
    return clean(
      el.getAttribute("aria-label") ||
        labelOf(el) ||
        el.getAttribute("placeholder") ||
        (el.tagName === "INPUT" ? "" : el.innerText) ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        el.getAttribute("name") ||
        "",
    );
  }

  function roleOf(el) {
    const role = el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return `input:${(el.getAttribute("type") || "text").toLowerCase()}`;
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function describe(el, ref) {
    const d = { ref, role: roleOf(el), name: nameOf(el) };
    const tag = el.tagName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if ((tag === "INPUT" || tag === "TEXTAREA") && type !== "password") {
      if (type === "checkbox" || type === "radio") d.checked = el.checked;
      else if (el.value) d.value = clean(el.value, 120);
    }
    if (tag === "SELECT") {
      d.value = clean(el.options[el.selectedIndex]?.text || "", 60);
      d.options = [...el.options].slice(0, 30).map((o) => clean(o.text, 40));
    }
    if (el.disabled) d.disabled = true;
    if (tag === "A") d.href = clean(el.getAttribute("href"), 120);
    return d;
  }

  function snapshot(maxText) {
    refs = new Map();
    let next = 1;
    const elements = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (elements.length >= MAX_ELEMENTS) break;
      if (!visible(el)) continue;
      const ref = next++;
      refs.set(ref, el);
      elements.push(describe(el, ref));
    }
    const all = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n");
    return {
      url: location.href,
      title: document.title,
      elements,
      text: all.slice(0, maxText),
      textTruncated: all.length > maxText,
    };
  }

  function el(ref) {
    const e = refs.get(Number(ref));
    if (!e || !e.isConnected) {
      throw new Error(`元素 [${ref}] 已经不在页面上了,先重新 browser_snapshot`);
    }
    return e;
  }

  function point(e) {
    e.scrollIntoView({ block: "center", inline: "center" });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function click(ref) {
    const e = el(ref);
    const { x, y } = point(e);
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      view: window,
    };
    e.dispatchEvent(new PointerEvent("pointerdown", opts));
    e.dispatchEvent(new MouseEvent("mousedown", opts));
    if (typeof e.focus === "function") e.focus();
    e.dispatchEvent(new PointerEvent("pointerup", opts));
    e.dispatchEvent(new MouseEvent("mouseup", opts));
    e.click();
    return describe(e, Number(ref));
  }

  const KEYS = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };

  function press(key, target) {
    const t = target || document.activeElement || document.body;
    const code = KEYS[key] || 0;
    const opts = {
      key: key === "Space" ? " " : key,
      code: key,
      keyCode: code,
      which: code,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const notPrevented = t.dispatchEvent(new KeyboardEvent("keydown", opts));
    t.dispatchEvent(new KeyboardEvent("keypress", opts));
    t.dispatchEvent(new KeyboardEvent("keyup", opts));
    // 合成的回车不会触发浏览器自带的"回车提交表单",这里补上
    if (key === "Enter" && notPrevented && t.form && t.tagName === "INPUT") {
      if (typeof t.form.requestSubmit === "function") t.form.requestSubmit();
      else t.form.submit();
    }
    return { key };
  }

  function type(ref, text, submit, append) {
    const e = el(ref);
    point(e);
    if (typeof e.focus === "function") e.focus();
    if (e.tagName === "INPUT" || e.tagName === "TEXTAREA") {
      const proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      // 走原型上的 setter:React 这类框架只认这样改的值
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(e, append ? e.value + text : text);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (e.isContentEditable) {
      if (!append) document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    } else {
      throw new Error(`元素 [${ref}] 不能输入文字`);
    }
    if (submit) press("Enter", e);
    return describe(e, Number(ref));
  }

  function select(ref, value) {
    const e = el(ref);
    if (e.tagName !== "SELECT") throw new Error(`元素 [${ref}] 不是下拉框`);
    const want = String(value);
    const opt = [...e.options].find((o) => o.value === want || clean(o.text, 200) === want);
    if (!opt) throw new Error(`下拉框 [${ref}] 里没有「${want}」`);
    e.value = opt.value;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
    return describe(e, Number(ref));
  }

  function scroll(dy, ref) {
    if (ref != null) point(el(ref));
    else window.scrollBy(0, Number(dy) || window.innerHeight * 0.8);
    return {
      scrollY: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  }

  window.__teraxAuto = { snapshot, click, type, press, select, scroll };
})();
