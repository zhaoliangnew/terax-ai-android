//! In-app browser tabs: each tab is a native child webview (WKWebView on
//! macOS) placed inside the main window over the right panel's page area.
//! Rendering, scrolling and input (including IME for Chinese) are all native;
//! the frontend only keeps the webview's bounds in sync with its placeholder
//! and drives navigation.
//!
//! Security: tab labels are namespaced (`web-*`) so the frontend can only
//! touch these, never the app's own webview; only http(s) URLs are loaded;
//! and the capabilities carry no `remote` entry, so pages here get no IPC.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const LABEL_PREFIX: &str = "web-";

/// Each web tab is *created* on this URL and then sent to the real page.
///
/// Why: tauri serves its `asset:` protocol (read scope `**`, the whole disk)
/// to every webview, answering with `Access-Control-Allow-Origin` set to the
/// origin of the URL the webview was created with. Created straight on
/// `https://some.site`, any script on that site could `fetch` local files
/// (verified: /etc/hosts came back). A `.invalid` host can never serve a page
/// (RFC 6761, and HTTPS rules out DNS hijacks), so no real page ever has the
/// origin the protocol trusts. `about:blank` won't do: it maps to origin
/// `null`, which a sandboxed iframe also has. The load itself is cancelled in
/// `on_navigation`, so no request goes out.
const ORIGIN_SHIELD: &str = "https://terax-inapp.invalid/";
const ORIGIN_SHIELD_HOST: &str = "terax-inapp.invalid";

fn is_shield(url: &Url) -> bool {
    url.host_str() == Some(ORIGIN_SHIELD_HOST)
}

/// Is this a URL of tauri's asset protocol (how local HTML files are served)?
fn is_asset(url: &Url) -> bool {
    url.scheme() == "asset" || url.host_str() == Some("asset.localhost")
}

/// `encodeURIComponent` for one path segment.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        let unreserved = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if unreserved {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Asset-protocol URL for a local file, one path segment encoded at a time so
/// the directory stays in the URL and the page's relative `./app.css` or
/// `./page2.html` resolve next to it (same scheme as the frontend's
/// `encodeAssetPath`; the handler strips one leading `/`, hence `%2F`).
pub fn asset_url(path: &std::path::Path) -> Result<Url, String> {
    let text = path.to_string_lossy().replace('\\', "/");
    let encoded: Vec<String> = text
        .split('/')
        .filter(|s| !s.is_empty())
        .map(encode_segment)
        .collect();
    let base = if cfg!(any(windows, target_os = "android")) {
        "http://asset.localhost/"
    } else {
        "asset://localhost/"
    };
    Url::parse(&format!("{base}%2F{}", encoded.join("/"))).map_err(|e| e.to_string())
}

/// A local HTML file the user asked to open: absolute, exists, .html/.htm.
fn local_html(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("不是绝对路径: {path}"));
    }
    let is_html = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
    if !is_html {
        return Err(format!("不是 html 文件: {path}"));
    }
    if !p.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    Ok(p)
}

/// Picker injected while annotating. It reports back by navigating to
/// `terax-annot://<kind>?d=<json>`, which `on_navigation` intercepts.
const ANNOTATE_JS: &str = include_str!("browser_annotate.js");
const ANNOT_SCHEME: &str = "terax-annot";
/// The minimized chat's round button, put into the page itself (the native
/// page covers anything the app draws over it). Clicking it navigates to
/// `terax-annot://chat`.
const BUBBLE_JS: &str = include_str!("browser_bubble.js");
const BUBBLE_STOP_JS: &str = "window.__teraxBubble && window.__teraxBubble.stop()";
/// Upper bound on one annotation report (the URL carries the JSON).
const MAX_ANNOT_BYTES: usize = 64 * 1024;

/// Live web tabs as the AI tools see them: which exist, what they show,
/// which one is on screen, and whether a page is still loading (so an action
/// that navigates can wait for the new page).
#[derive(Default)]
pub struct WebTabsState {
    inner: Mutex<TabsInner>,
    loaded: Condvar,
}

#[derive(Default)]
struct TabsInner {
    /// label -> (url, title, loading); `order` keeps open order.
    tabs: HashMap<String, (String, String, bool)>,
    order: Vec<String>,
    shown: Option<String>,
    ai_seq: u32,
    /// Tabs showing a local HTML file: only these may load `asset:` URLs.
    local: HashSet<String>,
}

impl WebTabsState {
    fn opened(&self, label: &str, url: &str) {
        let mut g = self.inner.lock().unwrap();
        g.tabs
            .insert(label.to_string(), (url.to_string(), String::new(), true));
        g.order.retain(|l| l != label);
        g.order.push(label.to_string());
    }

    fn closed(&self, label: &str) {
        let mut g = self.inner.lock().unwrap();
        g.tabs.remove(label);
        g.local.remove(label);
        g.order.retain(|l| l != label);
        if g.shown.as_deref() == Some(label) {
            g.shown = None;
        }
        drop(g);
        self.loaded.notify_all();
    }

    fn page_event(&self, label: &str, url: &str, loading: bool) {
        let mut g = self.inner.lock().unwrap();
        if let Some(t) = g.tabs.get_mut(label) {
            t.0 = url.to_string();
            t.2 = loading;
        }
        drop(g);
        if !loading {
            self.loaded.notify_all();
        }
    }

    fn titled(&self, label: &str, title: &str) {
        if let Some(t) = self.inner.lock().unwrap().tabs.get_mut(label) {
            t.1 = title.to_string();
        }
    }

    fn shown(&self, label: &str) {
        let mut g = self.inner.lock().unwrap();
        if g.tabs.contains_key(label) {
            g.shown = Some(label.to_string());
        }
    }

    fn allow_local(&self, label: &str) {
        self.inner.lock().unwrap().local.insert(label.to_string());
    }

    fn is_local(&self, label: &str) -> bool {
        self.inner.lock().unwrap().local.contains(label)
    }

    pub fn contains(&self, label: &str) -> bool {
        self.inner.lock().unwrap().tabs.contains_key(label)
    }

    /// The tab on screen, else the most recently opened one.
    pub fn current(&self) -> Option<String> {
        let g = self.inner.lock().unwrap();
        g.shown
            .clone()
            .filter(|l| g.tabs.contains_key(l))
            .or_else(|| g.order.last().cloned())
    }

    pub fn info(&self, label: &str) -> Option<(String, String)> {
        self.inner
            .lock()
            .unwrap()
            .tabs
            .get(label)
            .map(|t| (t.0.clone(), t.1.clone()))
    }

    /// (label, url, title) in open order.
    pub fn list(&self) -> Vec<(String, String, String)> {
        let g = self.inner.lock().unwrap();
        g.order
            .iter()
            .filter_map(|l| g.tabs.get(l).map(|t| (l.clone(), t.0.clone(), t.1.clone())))
            .collect()
    }

    pub fn next_ai_label(&self) -> String {
        let mut g = self.inner.lock().unwrap();
        g.ai_seq += 1;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("{LABEL_PREFIX}ai-{stamp}-{}", g.ai_seq)
    }

    pub fn is_loading(&self, label: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .tabs
            .get(label)
            .is_some_and(|t| t.2)
    }

    /// Before starting a navigation: count the tab as loading right away, so
    /// `wait_loaded` doesn't return before the page-load event arrives.
    pub fn mark_loading(&self, label: &str) {
        if let Some(t) = self.inner.lock().unwrap().tabs.get_mut(label) {
            t.2 = true;
        }
    }

    /// Block until the tab's page finished loading (or `timeout`). A load that
    /// never reports back (failed navigation) is cleared at the timeout so it
    /// doesn't stall every later call.
    pub fn wait_loaded(&self, label: &str, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let mut g = self.inner.lock().unwrap();
        while g.tabs.get(label).is_some_and(|t| t.2) {
            let now = Instant::now();
            if now >= deadline {
                if let Some(t) = g.tabs.get_mut(label) {
                    t.2 = false;
                }
                return;
            }
            g = self.loaded.wait_timeout(g, deadline - now).unwrap().0;
        }
    }
}

/// Tabs whose annotate mode is on. Reports from any other tab are dropped, so
/// a page can't push fake annotations into the chat on its own.
#[derive(Default)]
pub struct WebAnnotState {
    armed: Mutex<HashSet<String>>,
    /// The chat panel is minimized: every tab shows the round chat button.
    bubble: std::sync::atomic::AtomicBool,
}

impl WebAnnotState {
    fn is_armed(&self, label: &str) -> bool {
        self.armed.lock().unwrap().contains(label)
    }

    fn bubble_on(&self) -> bool {
        self.bubble.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// All tabs share one persistent store, separate from the app's own webview:
/// logins survive restarts but don't mix with the app's storage.
#[cfg(target_os = "macos")]
const DATA_STORE_ID: [u8; 16] = *b"terax-inapp-web1";

/// WKWebView's default User-Agent has no `Version/… Safari/…` part, and sites
/// that sniff the browser (钉钉文档 among them) reject it as unsupported. The
/// engine is Safari's WebKit, so report the installed Safari's own UA.
fn safari_user_agent() -> &'static str {
    static UA: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    UA.get_or_init(|| {
        let version = std::process::Command::new("defaults")
            .args([
                "read",
                "/Applications/Safari.app/Contents/Info",
                "CFBundleShortVersionString",
            ])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == '.'))
            .unwrap_or_else(|| "26.0".to_string());
        safari_ua_for(&version)
    })
}

pub fn safari_ua_for(version: &str) -> String {
    format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
         (KHTML, like Gecko) Version/{version} Safari/605.1.15"
    )
}

fn check_label(label: &str) -> Result<(), String> {
    if label.starts_with(LABEL_PREFIX) && label.len() <= 64 {
        Ok(())
    } else {
        Err(format!("invalid web tab label: {label}"))
    }
}

pub fn parse_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("网址不对: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("不支持的网址类型: {other}")),
    }
}

fn webview(app: &AppHandle, label: &str) -> Result<tauri::Webview, String> {
    check_label(label)?;
    app.get_webview(label)
        .ok_or_else(|| format!("web tab gone: {label}"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadEvent {
    label: String,
    url: String,
    loading: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitleEvent {
    label: String,
    title: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AnnotItem {
    #[serde(default)]
    tag: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    selector: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct AnnotReport {
    #[serde(default)]
    items: Vec<AnnotItem>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotEvent {
    label: String,
    /// "sync" = the list changed; "send" = send it; "exit" = the page's ✕.
    kind: String,
    url: String,
    title: String,
    items: Vec<AnnotItem>,
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Parse a `terax-annot://<kind>?d=<json>` report into an event.
pub fn parse_annotation(label: &str, url: &Url) -> Option<AnnotEventPub> {
    if url.scheme() != ANNOT_SCHEME || url.as_str().len() > MAX_ANNOT_BYTES {
        return None;
    }
    let kind = match url.host_str()? {
        k @ ("sync" | "send" | "exit") => k.to_string(),
        _ => return None,
    };
    let data = url.query_pairs().find(|(k, _)| k == "d")?.1;
    let report: AnnotReport = serde_json::from_str(&data).ok()?;
    let items = report
        .items
        .into_iter()
        .take(50)
        .map(|it| AnnotItem {
            tag: clip(&it.tag, 32),
            text: clip(&it.text, 120),
            selector: clip(&it.selector, 200),
            note: clip(&it.note, 2000),
        })
        .collect();
    Some(AnnotEventPub(AnnotEvent {
        label: label.to_string(),
        kind,
        url: clip(&report.url, 2000),
        title: clip(&report.title, 200),
        items,
    }))
}

/// Opaque wrapper so tests can inspect a parsed report.
pub struct AnnotEventPub(AnnotEvent);

impl AnnotEventPub {
    pub fn kind(&self) -> &str {
        &self.0.kind
    }
    pub fn notes(&self) -> Vec<String> {
        self.0.items.iter().map(|i| i.note.clone()).collect()
    }
}

/// Create a tab's webview at the given logical rect (window coordinates).
#[tauri::command]
pub async fn web_open(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    file: Option<String>,
) -> Result<(), String> {
    check_label(&label)?;
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    // 本地 html 文件走 asset 协议;这个标签页因此被允许加载 asset: 地址
    let target = match file.as_deref() {
        Some(path) => asset_url(&local_html(path)?)?,
        None => parse_url(&url)?,
    };
    let window = app.get_window("main").ok_or("main window not found")?;
    app.state::<WebTabsState>().opened(&label, target.as_str());
    if file.is_some() {
        app.state::<WebTabsState>().allow_local(&label);
    }

    let load_app = app.clone();
    let title_app = app.clone();
    let nav_app = app.clone();
    let nav_label = label.clone();
    let win_app = app.clone();
    let win_label = label.clone();
    let shield = Url::parse(ORIGIN_SHIELD).map_err(|e| e.to_string())?;
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(shield))
        .on_navigation(move |url| {
            if is_shield(url) {
                return false;
            }
            // 本地文件(asset:)只许"本地文件标签页"打开:不然网页一句
            // location.href = "asset://..." 就能把你的文件显示出来给 AI 读
            if is_asset(url) {
                return nav_app
                    .try_state::<WebTabsState>()
                    .is_some_and(|s| s.is_local(&nav_label));
            }
            if url.scheme() != ANNOT_SCHEME {
                return true;
            }
            // 最小化聊天的小圆钮:只是请 app 把聊天输入框叫回来,页面伪造了也无害
            if url.host_str() == Some("chat") {
                if nav_app
                    .try_state::<WebAnnotState>()
                    .is_some_and(|s| s.bubble_on())
                {
                    let _ = nav_app.emit("web://chat-bubble", nav_label.clone());
                }
                return false;
            }
            // 批注的回报:只收正在批注的 tab;无论收不收,这次跳转都拦下
            let armed = nav_app
                .try_state::<WebAnnotState>()
                .is_some_and(|s| s.is_armed(&nav_label));
            if armed {
                if let Some(ev) = parse_annotation(&nav_label, url) {
                    let _ = nav_app.emit("web://annotations", ev.0);
                }
            }
            false
        })
        // target="_blank" / window.open:嵌入的网页没有"新窗口",就在当前
        // 标签页里打开,不然这类链接点了没反应(百度的搜索结果全是这种)
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                if let Some(wv) = win_app.get_webview(&win_label) {
                    let _ = wv.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |wv, payload| {
            if is_shield(payload.url()) {
                return;
            }
            let started = matches!(payload.event(), PageLoadEvent::Started);
            // 登录态多是会话 cookie,WebKit 不落盘:每页加载完记一份,重开时放回
            if !started {
                super::browser_cookies::remember(&load_app, &wv);
            }
            if let Some(tabs) = load_app.try_state::<WebTabsState>() {
                tabs.page_event(wv.label(), payload.url().as_str(), started);
            }
            let _ = load_app.emit(
                "web://load",
                LoadEvent {
                    label: wv.label().to_string(),
                    url: payload.url().to_string(),
                    loading: started,
                },
            );
            // 聊天最小化着:新页面里也放上小圆钮
            if !started
                && load_app
                    .try_state::<WebAnnotState>()
                    .is_some_and(|s| s.bubble_on())
            {
                let _ = wv.eval(BUBBLE_JS);
            }
            // 批注中翻页了:新页面没有选择器,重新放进去
            if !started
                && load_app
                    .try_state::<WebAnnotState>()
                    .is_some_and(|s| s.is_armed(wv.label()))
            {
                let _ = wv.eval(ANNOTATE_JS);
            }
        })
        .on_document_title_changed(move |wv, title| {
            if let Some(tabs) = title_app.try_state::<WebTabsState>() {
                tabs.titled(wv.label(), &title);
            }
            let _ = title_app.emit(
                "web://title",
                TitleEvent {
                    label: wv.label().to_string(),
                    title,
                },
            );
        });
    #[cfg(target_os = "macos")]
    let builder = builder
        .data_store_identifier(DATA_STORE_ID)
        .user_agent(safari_user_agent());

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| {
            app.state::<WebTabsState>().closed(&label);
            format!("打开网页失败: {e}")
        })?;
    // 先把记下的会话 cookie 放回去,不然每次都要重新登录
    super::browser_cookies::restore(&app, &webview);
    // 建在占位地址上(见 ORIGIN_SHIELD),再去真正的页面
    webview
        .navigate(target)
        .map_err(|e| format!("打开网页失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn web_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn web_set_visible(app: AppHandle, label: String, visible: bool) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    if visible {
        app.state::<WebTabsState>().shown(&label);
    }
    if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn web_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    wv.navigate(parse_url(&url)?).map_err(|e| e.to_string())
}

/// Open a local HTML file in an existing tab (typed into its address bar).
#[tauri::command]
pub fn web_navigate_file(app: AppHandle, label: String, path: String) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    let url = asset_url(&local_html(&path)?)?;
    app.state::<WebTabsState>().allow_local(&label);
    wv.navigate(url).map_err(|e| e.to_string())
}

/// back / forward / reload go through page history, so no URL is needed.
#[tauri::command]
pub fn web_history(app: AppHandle, label: String, action: String) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.reload(),
        other => return Err(format!("unknown history action: {other}")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn web_close(
    app: AppHandle,
    state: tauri::State<'_, WebAnnotState>,
    label: String,
) -> Result<(), String> {
    check_label(&label)?;
    state.armed.lock().unwrap().remove(&label);
    app.state::<WebTabsState>().closed(&label);
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show or hide the minimized chat's round button in every web tab.
#[tauri::command]
pub fn web_chat_bubble(
    app: AppHandle,
    state: tauri::State<'_, WebAnnotState>,
    on: bool,
) -> Result<(), String> {
    state
        .bubble
        .store(on, std::sync::atomic::Ordering::Relaxed);
    let js = if on { BUBBLE_JS } else { BUBBLE_STOP_JS };
    for (label, wv) in app.webviews() {
        if label.starts_with("web-") {
            let _ = wv.eval(js);
        }
    }
    Ok(())
}

/// Turn annotate mode on or off for a tab.
#[tauri::command]
pub fn web_annotate(
    app: AppHandle,
    state: tauri::State<'_, WebAnnotState>,
    label: String,
    on: bool,
) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    let mut armed = state.armed.lock().unwrap();
    if on {
        armed.insert(label);
        wv.eval(ANNOTATE_JS).map_err(|e| e.to_string())
    } else {
        armed.remove(&label);
        wv.eval("window.__teraxAnnot && window.__teraxAnnot.stop()")
            .map_err(|e| e.to_string())
    }
}

/// Edit the in-page list from the app side: `clear`, or `remove` one item.
#[tauri::command]
pub fn web_annotate_edit(
    app: AppHandle,
    label: String,
    action: String,
    index: Option<u32>,
) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    let js = match (action.as_str(), index) {
        ("clear", _) => "window.__teraxAnnot && window.__teraxAnnot.clear()".to_string(),
        ("remove", Some(i)) => format!("window.__teraxAnnot && window.__teraxAnnot.remove({i})"),
        _ => return Err(format!("unknown annotate action: {action}")),
    };
    wv.eval(js).map_err(|e| e.to_string())
}

/// Close every web tab. The frontend calls it once on startup: native child
/// webviews outlive a page reload of the app's own webview, and orphans would
/// float over the UI with no tab to own them.
#[tauri::command]
pub fn web_close_all(app: AppHandle) {
    for (label, wv) in app.webviews() {
        if label.starts_with(LABEL_PREFIX) {
            app.state::<WebTabsState>().closed(&label);
            let _ = wv.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_namespaced_labels() {
        assert!(check_label("web-1").is_ok());
        assert!(check_label("main").is_err());
        assert!(check_label("settings").is_err());
    }

    #[test]
    fn parses_annotation_reports() {
        let d = r#"{"items":[{"tag":"button","text":"提交","selector":"form > button","note":"点了没反应"}],"url":"https://a.com/x","title":"A"}"#;
        let mut url = Url::parse("terax-annot://send").unwrap();
        url.query_pairs_mut().append_pair("d", d);
        let ev = parse_annotation("web-1", &url).unwrap();
        assert_eq!(ev.kind(), "send");
        assert_eq!(ev.notes(), vec!["点了没反应".to_string()]);

        let bad_kind = Url::parse("terax-annot://evil?d=%7B%7D").unwrap();
        assert!(parse_annotation("web-1", &bad_kind).is_none());
        let other = Url::parse("https://a.com/?d=%7B%7D").unwrap();
        assert!(parse_annotation("web-1", &other).is_none());
    }

    #[test]
    fn safari_ua_looks_like_safari() {
        let ua = safari_ua_for("26.1");
        assert!(ua.contains("Version/26.1 Safari/605.1.15"));
        assert!(ua.starts_with("Mozilla/5.0 (Macintosh;"));
        assert!(!ua.contains("  "));
    }

    #[test]
    fn origin_shield_is_unreachable_and_recognized() {
        let shield = Url::parse(ORIGIN_SHIELD).unwrap();
        assert_eq!(shield.scheme(), "https");
        assert!(shield.host_str().unwrap().ends_with(".invalid"));
        assert!(is_shield(&shield));
        assert!(!is_shield(&Url::parse("https://example.com/").unwrap()));
    }

    #[test]
    fn asset_urls_keep_directories() {
        let url = asset_url(std::path::Path::new("/Users/me/报告 1/index.html")).unwrap();
        #[cfg(not(any(windows, target_os = "android")))]
        assert_eq!(
            url.as_str(),
            "asset://localhost/%2FUsers/me/%E6%8A%A5%E5%91%8A%201/index.html"
        );
        assert!(is_asset(&url));
        assert!(!is_asset(&Url::parse("https://example.com/").unwrap()));
    }

    #[test]
    fn local_html_needs_an_existing_absolute_html_file() {
        let dir = tempfile::tempdir().unwrap();
        let page = dir.path().join("a.HTML");
        std::fs::write(&page, "<p>x</p>").unwrap();
        assert!(local_html(page.to_str().unwrap()).is_ok());
        assert!(local_html("relative/a.html").is_err());
        assert!(local_html(dir.path().join("missing.html").to_str().unwrap()).is_err());
        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(local_html(txt.to_str().unwrap()).is_err());
    }

    #[test]
    fn only_http_urls() {
        assert!(parse_url("https://baidu.com").is_ok());
        assert!(parse_url("http://39.100.83.89:40135").is_ok());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("tauri://localhost").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
    }
}
