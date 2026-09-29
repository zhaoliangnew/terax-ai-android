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
  return url === "about:blank" ? "" : url;
}
