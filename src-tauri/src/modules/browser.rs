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
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

const LABEL_PREFIX: &str = "web-";

/// Picker injected while annotating. It reports back by navigating to
/// `terax-annot://<kind>?d=<json>`, which `on_navigation` intercepts.
const ANNOTATE_JS: &str = include_str!("browser_annotate.js");
const ANNOT_SCHEME: &str = "terax-annot";
/// Upper bound on one annotation report (the URL carries the JSON).
const MAX_ANNOT_BYTES: usize = 64 * 1024;

/// Tabs whose annotate mode is on. Reports from any other tab are dropped, so
/// a page can't push fake annotations into the chat on its own.
#[derive(Default)]
pub struct WebAnnotState {
    armed: Mutex<HashSet<String>>,
}

impl WebAnnotState {
    fn is_armed(&self, label: &str) -> bool {
        self.armed.lock().unwrap().contains(label)
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

fn parse_url(url: &str) -> Result<Url, String> {
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
) -> Result<(), String> {
    check_label(&label)?;
    if app.get_webview(&label).is_some() {
        return Ok(());
    }
    let target = parse_url(&url)?;
    let window = app.get_window("main").ok_or("main window not found")?;

    let load_app = app.clone();
    let title_app = app.clone();
    let nav_app = app.clone();
    let nav_label = label.clone();
    let win_app = app.clone();
    let win_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
        .on_navigation(move |url| {
            if url.scheme() != ANNOT_SCHEME {
                return true;
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
            let started = matches!(payload.event(), PageLoadEvent::Started);
            let _ = load_app.emit(
                "web://load",
                LoadEvent {
                    label: wv.label().to_string(),
                    url: payload.url().to_string(),
                    loading: started,
                },
            );
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

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
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
    if visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn web_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = webview(&app, &label)?;
    wv.navigate(parse_url(&url)?).map_err(|e| e.to_string())
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
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
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
    fn only_http_urls() {
        assert!(parse_url("https://baidu.com").is_ok());
        assert!(parse_url("http://39.100.83.89:40135").is_ok());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("tauri://localhost").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
    }
}
