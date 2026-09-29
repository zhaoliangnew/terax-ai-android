//! Lets AI tools drive the in-app web tabs (the MCP server in `terax-cli`
//! reaches these through the control server). Reading and acting go through
//! `browser_automation.js`, evaluated with WKWebView's
//! `evaluateJavaScript:completionHandler:` so results come back (tauri's own
//! `eval` is fire-and-forget); screenshots use `takeSnapshot`, which needs no
//! screen-recording permission.
//!
//! Every call runs on a control-server worker thread and blocks until the
//! main thread's completion handler answers, so it must never be called from
//! the main thread.

use crate::modules::browser::{parse_url, WebTabsState};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Webview};

const HELPER_JS: &str = include_str!("browser_automation.js");
const EVAL_TIMEOUT: Duration = Duration::from_secs(10);
const LOAD_TIMEOUT: Duration = Duration::from_secs(15);
/// After a click or key press, how long to watch for a navigation to start.
/// A link's page load can take a moment to begin; a click that only updates
/// the page (SPA) just costs this much.
const SETTLE: Duration = Duration::from_millis(1000);
const DEFAULT_MAX_TEXT: usize = 6000;

#[cfg(target_os = "macos")]
mod native {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
    };
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::WKWebView;
    use std::sync::mpsc;
    use std::time::Duration;

    fn error_text(error: *mut NSError, fallback: &str) -> String {
        if error.is_null() {
            fallback.to_string()
        } else {
            // SAFETY: WebKit hands us a valid NSError for the duration of the callback.
            unsafe { (*error).localizedDescription().to_string() }
        }
    }

    /// Evaluate `js`; the script's final value must be a string.
    pub fn eval_string(
        wv: &tauri::Webview,
        js: String,
        timeout: Duration,
    ) -> Result<String, String> {
        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        wv.with_webview(move |pw| {
            let handler = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
                let out = if !error.is_null() {
                    Err(error_text(error, "脚本出错"))
                } else if result.is_null() {
                    Ok("null".to_string())
                } else {
                    // SAFETY: non-null result object is valid during the callback.
                    match unsafe { (*result).downcast_ref::<NSString>() } {
                        Some(s) => Ok(s.to_string()),
                        None => Err("页面返回了非文本结果".to_string()),
                    }
                };
                let _ = tx.send(out);
            });
            // SAFETY: on macOS `inner()` is the live WKWebView, and this closure
            // runs on the main thread as WebKit requires.
            unsafe {
                let webview = &*(pw.inner() as *mut WKWebView);
                webview
                    .evaluateJavaScript_completionHandler(&NSString::from_str(&js), Some(&handler));
            }
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| "页面没有响应(超时)".to_string())?
    }

    fn jpeg_of(image: &NSImage) -> Result<Vec<u8>, String> {
        let tiff = image.TIFFRepresentation().ok_or("截图转码失败")?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("截图转码失败")?;
        let props: Retained<NSDictionary<NSBitmapImageRepPropertyKey, AnyObject>> =
            NSDictionary::new();
        // SAFETY: plain AppKit call with a valid rep and an empty property dictionary.
        let data =
            unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &props) }
                .ok_or("截图转码失败")?;
        Ok(data.to_vec())
    }

    /// Snapshot of what the web view currently shows, as JPEG bytes.
    pub fn snapshot_jpeg(wv: &tauri::Webview, timeout: Duration) -> Result<Vec<u8>, String> {
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        wv.with_webview(move |pw| {
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let out = if image.is_null() {
                    Err(error_text(error, "截图失败"))
                } else {
                    // SAFETY: non-null image is valid during the callback.
                    jpeg_of(unsafe { &*image })
                };
                let _ = tx.send(out);
            });
            // SAFETY: see eval_string.
            unsafe {
                let webview = &*(pw.inner() as *mut WKWebView);
                webview.takeSnapshotWithConfiguration_completionHandler(None, &handler);
            }
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| "截图超时".to_string())?
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use std::time::Duration;

    pub fn eval_string(_: &tauri::Webview, _: String, _: Duration) -> Result<String, String> {
        Err("内嵌浏览器自动化目前只支持 macOS".into())
    }

    pub fn snapshot_jpeg(_: &tauri::Webview, _: Duration) -> Result<Vec<u8>, String> {
        Err("内嵌浏览器自动化目前只支持 macOS".into())
    }
}

/// Run `expr` (an expression over `window.__teraxAuto`) and return its value.
fn call(wv: &Webview, expr: &str) -> Result<Value, String> {
    let js = format!(
        "{HELPER_JS}\n;(() => {{ try {{ const v = ({expr}); \
         return JSON.stringify({{ ok: true, v: v === undefined ? null : v }}); }} \
         catch (e) {{ return JSON.stringify({{ ok: false, e: String((e && e.message) || e) }}); }} }})()"
    );
    let raw = native::eval_string(wv, js, EVAL_TIMEOUT)?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("页面结果解析失败: {e}"))?;
    if parsed["ok"].as_bool() == Some(true) {
        Ok(parsed["v"].clone())
    } else {
        Err(parsed["e"].as_str().unwrap_or("页面脚本出错").to_string())
    }
}

/// A JS literal for `s` (JSON strings are valid JS string literals).
fn lit(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// Pick the tab to act on: the one asked for, else the one on screen, else the
/// most recently opened.
fn resolve(app: &AppHandle, tab: Option<&str>) -> Result<(String, Webview), String> {
    let state = app.state::<WebTabsState>();
    let label = match tab {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => state
            .current()
            .ok_or("内嵌浏览器里还没有打开的网页,先用 browser_open 打开一个")?,
    };
    let wv = app
        .get_webview(&label)
        .filter(|_| state.contains(&label))
        .ok_or_else(|| format!("没有这个网页标签页: {label}"))?;
    Ok((label, wv))
}

/// Tell the app an AI is acting on a tab: it switches the right panel to it and
/// shows an "AI 正在操作" badge.
fn announce(app: &AppHandle, label: &str, action: &str) {
    let _ = app.emit(
        "web://ai-activity",
        json!({ "label": label, "action": action }),
    );
}

fn page_info(app: &AppHandle, label: &str) -> Value {
    let (url, title) = app.state::<WebTabsState>().info(label).unwrap_or_default();
    json!({ "tab": label, "url": url, "title": title })
}

/// Accept "baidu.com" as well as full URLs.
fn normalize_url(input: &str) -> Result<tauri::Url, String> {
    let s = input.trim();
    // 写了协议就原样检查(file:// 之类照样拒);没写才补
    if s.contains("://") {
        return parse_url(s);
    }
    parse_url(s).or_else(|_| {
        let scheme = if s.starts_with("localhost") || s.starts_with(|c: char| c.is_ascii_digit()) {
            "http"
        } else {
            "https"
        };
        parse_url(&format!("{scheme}://{s}"))
    })
}

pub fn tabs(app: &AppHandle) -> Value {
    let state = app.state::<WebTabsState>();
    let current = state.current();
    let list: Vec<Value> = state
        .list()
        .into_iter()
        .map(|(label, url, title)| {
            json!({ "tab": label, "url": url, "title": title, "current": current.as_deref() == Some(label.as_str()) })
        })
        .collect();
    json!({ "tabs": list })
}

/// Open a new tab in the right panel (the app creates it, so it shows up like
/// one the user opened) and wait for the page to load.
pub fn open(app: &AppHandle, url: &str) -> Result<Value, String> {
    let url = normalize_url(url)?;
    let label = app.state::<WebTabsState>().next_ai_label();
    app.emit(
        "web://ai-open",
        json!({ "label": label, "url": url.as_str() }),
    )
    .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(8);
    while app.get_webview(&label).is_none() {
        if Instant::now() > deadline {
            return Err("右栏没能打开网页标签页(App 窗口开着吗?)".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    announce(app, &label, "打开网页");
    app.state::<WebTabsState>()
        .wait_loaded(&label, LOAD_TIMEOUT);
    Ok(page_info(app, &label))
}

pub fn navigate(app: &AppHandle, tab: Option<&str>, url: &str) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    let url = normalize_url(url)?;
    announce(app, &label, "打开网址");
    let state = app.state::<WebTabsState>();
    state.mark_loading(&label);
    wv.navigate(url).map_err(|e| e.to_string())?;
    state.wait_loaded(&label, LOAD_TIMEOUT);
    Ok(page_info(app, &label))
}

pub fn back(app: &AppHandle, tab: Option<&str>) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    announce(app, &label, "后退");
    wv.eval("history.back()").map_err(|e| e.to_string())?;
    settle(app, &label);
    Ok(page_info(app, &label))
}

pub fn snapshot(
    app: &AppHandle,
    tab: Option<&str>,
    max_text: Option<usize>,
) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    announce(app, &label, "读取页面");
    let max = max_text.unwrap_or(DEFAULT_MAX_TEXT).clamp(500, 50_000);
    let mut v = call(&wv, &format!("window.__teraxAuto.snapshot({max})"))?;
    v["tab"] = json!(label);
    Ok(v)
}

/// Wait for whatever a click or key press set off: if a page load starts
/// within `SETTLE`, wait for it to finish; otherwise it was an in-page update.
fn settle(app: &AppHandle, label: &str) {
    let state = app.state::<WebTabsState>();
    let deadline = Instant::now() + SETTLE;
    while Instant::now() < deadline {
        if state.is_loading(label) {
            state.wait_loaded(label, LOAD_TIMEOUT);
            // 跳转后页面脚本往往还要再渲染一下
            std::thread::sleep(Duration::from_millis(300));
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn act(app: &AppHandle, tab: Option<&str>, action: &str, expr: String) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    announce(app, &label, action);
    let element = call(&wv, &expr)?;
    settle(app, &label);
    let mut out = page_info(app, &label);
    out["element"] = element;
    Ok(out)
}

pub fn click(app: &AppHandle, tab: Option<&str>, element: u32) -> Result<Value, String> {
    act(
        app,
        tab,
        "点击",
        format!("window.__teraxAuto.click({element})"),
    )
}

pub fn type_text(
    app: &AppHandle,
    tab: Option<&str>,
    element: u32,
    text: &str,
    submit: bool,
    append: bool,
) -> Result<Value, String> {
    act(
        app,
        tab,
        "输入",
        format!(
            "window.__teraxAuto.type({element}, {}, {submit}, {append})",
            lit(text)
        ),
    )
}

pub fn press(app: &AppHandle, tab: Option<&str>, key: &str) -> Result<Value, String> {
    act(
        app,
        tab,
        "按键",
        format!("window.__teraxAuto.press({})", lit(key)),
    )
}

pub fn select(
    app: &AppHandle,
    tab: Option<&str>,
    element: u32,
    value: &str,
) -> Result<Value, String> {
    act(
        app,
        tab,
        "选择",
        format!("window.__teraxAuto.select({element}, {})", lit(value)),
    )
}

pub fn scroll(
    app: &AppHandle,
    tab: Option<&str>,
    dy: Option<i64>,
    element: Option<u32>,
) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    announce(app, &label, "滚动");
    let dy = dy.map_or("null".to_string(), |d| d.to_string());
    let el = element.map_or("null".to_string(), |e| e.to_string());
    call(&wv, &format!("window.__teraxAuto.scroll({dy}, {el})"))
}

/// Save a JPEG of the tab to a temp file and return its path; the MCP server
/// reads it back (keeps control-server messages small).
pub fn screenshot(app: &AppHandle, tab: Option<&str>) -> Result<Value, String> {
    let (label, wv) = resolve(app, tab)?;
    announce(app, &label, "截图");
    let bytes = native::snapshot_jpeg(&wv, EVAL_TIMEOUT)?;
    let dir = std::env::temp_dir().join("terax-browser");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("shot-{stamp}.jpg"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let mut out = page_info(app, &label);
    out["path"] = json!(path.to_string_lossy());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literals_escape_quotes_and_newlines() {
        assert_eq!(lit("a\"b\nc"), r#""a\"b\nc""#);
        assert_eq!(lit("</script>"), r#""</script>""#);
    }

    #[test]
    fn normalizes_bare_hosts() {
        assert_eq!(
            normalize_url("baidu.com").unwrap().as_str(),
            "https://baidu.com/"
        );
        assert_eq!(
            normalize_url("39.100.83.89:40135").unwrap().as_str(),
            "http://39.100.83.89:40135/"
        );
        assert_eq!(
            normalize_url("localhost:3000").unwrap().as_str(),
            "http://localhost:3000/"
        );
        assert!(normalize_url("file:///etc/passwd").is_err());
    }
}

/// A still frame of a web tab (JPEG bytes). The native page sits above all
/// app UI, so while a floating panel (the chat card) covers it the page is
/// hidden and this frame is shown in its place.
#[tauri::command]
pub async fn web_freeze_frame(app: AppHandle, label: String) -> Result<tauri::ipc::Response, String> {
    // The snapshot callback runs on the main thread; wait for it off of it.
    tauri::async_runtime::spawn_blocking(move || {
        let (_, wv) = resolve(&app, Some(&label))?;
        native::snapshot_jpeg(&wv, Duration::from_secs(3)).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}
