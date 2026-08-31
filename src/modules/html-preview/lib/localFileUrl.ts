import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Percent-encodes a file path for Tauri's asset protocol *one path segment at a
 * time*, so the directory structure stays visible in the URL.
 *
 * `convertFileSrc()` encodes the whole path into a single segment, which is
 * fine for an `<img>` but breaks a framed document: every relative subresource
 * then resolves against the origin root, so a `./app.css` sitting next to the
 * page becomes `asset://localhost/app.css` and 404s. The asset handler strips
 * exactly one leading `/` before decoding the rest (tauri
 * `src/protocol/asset.rs`), so encoding the leading slash as `%2F` and leaving
 * the separators alone round-trips to the same absolute path while letting the
 * WebView resolve siblings correctly.
 *
 * `..` never reaches the handler — the WebView normalises it away during URL
 * resolution, which is what keeps Tauri's own traversal guard happy.
 */
export function encodeAssetPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const encoded = normalized
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return normalized.startsWith("/") ? `%2F${encoded}` : encoded;
}

/** Asset-protocol URL for a local file, usable as an `<iframe src>`. */
export function localFileUrl(path: string): string {
  // convertFileSrc("") yields the bare origin plus trailing slash, which differs
  // per platform (`asset://localhost/` vs `http://asset.localhost/`); let Tauri
  // own that detail rather than sniffing the platform here.
  return `${convertFileSrc("")}${encodeAssetPath(path)}`;
}
