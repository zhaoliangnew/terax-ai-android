/**
 * 网址栏输入的东西:不用手敲协议。内网(localhost、IP、带端口的主机名)补
 * http://,域名补 https://,都不像就丢给搜索。
 */
export function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("about:")) return s;
  if (/\s/.test(s)) {
    return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
  }
  // 内网:localhost、IP、或 主机名:端口 —— 多半没证书,走 http
  if (
    /^localhost([:/]|$)/i.test(s) ||
    /^\d{1,3}(\.\d{1,3}){3}([:/]|$)/.test(s) ||
    /^[\w-]+(\.[\w-]+)*:\d+([/?#]|$)/.test(s)
  ) {
    return `http://${s}`;
  }
  // 带点的域名
  if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

/** 地址栏里显示的样子:空白页不显示 about:blank,好直接开打。 */
export function displayUrl(url: string): string {
  if (url === "about:blank") return "";
  return assetToPath(url) ?? url;
}

/**
 * 输入/链接里的本地 html 文件:绝对路径、`~/` 开头或 `file://`,以 .html/.htm
 * 结尾(可带 #锚点、?参数,打开时去掉)。相对路径给了 `cwd` 就按它补全。
 * 不是就返回 null。
 */
export function localHtmlPath(
  input: string,
  cwd?: string | null,
  home?: string | null,
): string | null {
  let s = input.trim();
  if (s.startsWith("file://")) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
    } catch {
      return null;
    }
  }
  s = s.replace(/[?#].*$/, "");
  if (!/\.html?$/i.test(s) || /\s/.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) {
    return null;
  }
  if (s.startsWith("~/")) return home ? `${home}${s.slice(1)}` : null;
  if (s.startsWith("/")) return s;
  if (!cwd) return null;
  const parts = `${cwd}/${s}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `/${out.join("/")}`;
}

/** 本地文件 tab 的地址(asset 协议)还原成文件路径,地址栏里好认。 */
export function assetToPath(url: string): string | null {
  const m = url.match(
    /^(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\/(.*)$/,
  );
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).replace(/^\/*/, "/");
  } catch {
    return null;
  }
}
