//! `terax-cli mcp`: an MCP server on stdio that lets AI tools (Claude Code,
//! Codex) drive the in-app browser in the right panel of the running app.
//! Each tool call becomes one `browser.*` request to the app's control server.
//!
//! stdout carries only protocol messages (newline-delimited JSON-RPC); any
//! diagnostics go to stderr.

use std::io::{self, BufRead, Write};
use std::time::Duration;

use serde_json::{json, Value};
use terax_control_protocol::{CallerContext, ControlRequest, PROTOCOL_VERSION};

use super::{load_endpoint, request_id, send_request};

/// Browser calls wait for pages to load, so give them room.
const BROWSER_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_PROTOCOL: &str = "2025-06-18";

const INSTRUCTIONS: &str = "These tools drive the browser built into the Terax app \
(the web tabs in its right panel). The user sees every action live and is usually \
logged in to their internal systems there. Workflow: browser_open or browser_navigate, \
then browser_snapshot to read the page and get element numbers, then browser_click / \
browser_type / browser_select with those numbers, then browser_snapshot again to see \
the result. Element numbers are only valid until the next snapshot or page change. \
Use browser_screenshot when the layout or visuals matter.";

pub fn serve() -> Result<(), super::CliError> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            write_message(
                &mut stdout,
                &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }),
            );
            continue;
        };
        // Notifications (no id) need no answer.
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let response = match handle(method, &params) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, text)) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } })
            }
        };
        write_message(&mut stdout, &response);
    }
    Ok(())
}

fn write_message(out: &mut impl Write, message: &Value) {
    let _ = writeln!(out, "{message}");
    let _ = out.flush();
}

fn handle(method: &str, params: &Value) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => {
            let version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_PROTOCOL);
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "terax-browser", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            Ok(call_tool(name, &args))
        }
        other => Err((-32601, format!("method not found: {other}"))),
    }
}

fn schema(props: Value, required: &[&str]) -> Value {
    let mut props = props.as_object().cloned().unwrap_or_default();
    props.insert(
        "tab".into(),
        json!({ "type": "string", "description": "Tab id from browser_tabs; defaults to the tab on screen." }),
    );
    json!({ "type": "object", "properties": Value::Object(props), "required": required })
}

fn tools() -> Vec<Value> {
    let element = json!({ "type": "integer", "description": "Element number from the latest browser_snapshot." });
    vec![
        json!({
            "name": "browser_tabs",
            "description": "List the open web tabs in the Terax in-app browser (id, title, url, which one is on screen).",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true },
        }),
        json!({
            "name": "browser_open",
            "description": "Open a URL in a new tab of the Terax in-app browser and wait for it to load. Scheme is optional (baidu.com, 10.0.0.5:8080).",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] },
        }),
        json!({
            "name": "browser_navigate",
            "description": "Load a URL in an existing tab and wait for it to load.",
            "inputSchema": schema(json!({ "url": { "type": "string" } }), &["url"]),
        }),
        json!({
            "name": "browser_back",
            "description": "Go back in the tab's history.",
            "inputSchema": schema(json!({}), &[]),
        }),
        json!({
            "name": "browser_snapshot",
            "description": "Read the current page: title, url, every visible interactive element with a number (use it with click/type/select), and the page text.",
            "inputSchema": schema(json!({
                "max_text": { "type": "integer", "description": "Max characters of page text (default 6000)." }
            }), &[]),
            "annotations": { "readOnlyHint": true },
        }),
        json!({
            "name": "browser_click",
            "description": "Click an element by its snapshot number. Waits for any navigation it starts.",
            "inputSchema": schema(json!({ "element": element }), &["element"]),
        }),
        json!({
            "name": "browser_type",
            "description": "Type text into an input, textarea or editable element by its snapshot number (replaces the value unless append). submit=true presses Enter afterwards.",
            "inputSchema": schema(json!({
                "element": element,
                "text": { "type": "string" },
                "submit": { "type": "boolean" },
                "append": { "type": "boolean" }
            }), &["element", "text"]),
        }),
        json!({
            "name": "browser_press",
            "description": "Press a key on the focused element: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space.",
            "inputSchema": schema(json!({ "key": { "type": "string" } }), &["key"]),
        }),
        json!({
            "name": "browser_select",
            "description": "Choose an option in a <select> by its value or visible text.",
            "inputSchema": schema(json!({ "element": element, "value": { "type": "string" } }), &["element", "value"]),
        }),
        json!({
            "name": "browser_scroll",
            "description": "Scroll the page by dy pixels (negative = up; default one screen down), or scroll an element into view.",
            "inputSchema": schema(json!({ "dy": { "type": "integer" }, "element": element }), &[]),
        }),
        json!({
            "name": "browser_screenshot",
            "description": "Take a screenshot of the tab as it looks now.",
            "inputSchema": schema(json!({}), &[]),
            "annotations": { "readOnlyHint": true },
        }),
    ]
}

/// Tool name -> control method, with the arguments passed through.
fn control_method(name: &str) -> Option<&'static str> {
    Some(match name {
        "browser_tabs" => "browser.tabs",
        "browser_open" => "browser.open",
        "browser_navigate" => "browser.navigate",
        "browser_back" => "browser.back",
        "browser_snapshot" => "browser.snapshot",
        "browser_click" => "browser.click",
        "browser_type" => "browser.type",
        "browser_press" => "browser.press",
        "browser_select" => "browser.select",
        "browser_scroll" => "browser.scroll",
        "browser_screenshot" => "browser.screenshot",
        _ => return None,
    })
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn call_tool(name: &str, args: &Value) -> Value {
    let Some(method) = control_method(name) else {
        return text_result(format!("unknown tool: {name}"), true);
    };
    match request(method, args) {
        Ok(result) => render(name, &result),
        Err(message) => text_result(message, true),
    }
}

fn request(method: &str, args: &Value) -> Result<Value, String> {
    let endpoint =
        load_endpoint().map_err(|e| format!("连不上 Terax(App 开着吗?): {}", e.message))?;
    let request = ControlRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id(),
        token: endpoint.token,
        method: method.to_string(),
        params: args.clone(),
        caller: CallerContext::default(),
    };
    let response =
        send_request(&endpoint.address, &request, BROWSER_TIMEOUT).map_err(|e| e.message)?;
    if response.ok {
        Ok(response.result.unwrap_or(Value::Null))
    } else {
        Err(response
            .error
            .map(|e| e.message)
            .unwrap_or_else(|| "Terax rejected the request".into()))
    }
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn page_line(v: &Value) -> String {
    format!("tab {} · {} · {}", s(v, "tab"), s(v, "title"), s(v, "url"))
}

fn render(name: &str, v: &Value) -> Value {
    match name {
        "browser_snapshot" => text_result(render_snapshot(v), false),
        "browser_tabs" => {
            let tabs = v
                .get("tabs")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if tabs.is_empty() {
                return text_result("No web tabs are open. Use browser_open.".into(), false);
            }
            let lines: Vec<String> = tabs
                .iter()
                .map(|t| {
                    let mark = if t.get("current").and_then(Value::as_bool) == Some(true) {
                        " (on screen)"
                    } else {
                        ""
                    };
                    format!(
                        "- {}{mark}: {} · {}",
                        s(t, "tab"),
                        s(t, "title"),
                        s(t, "url")
                    )
                })
                .collect();
            text_result(lines.join("\n"), false)
        }
        "browser_screenshot" => {
            let path = s(v, "path");
            match std::fs::read(path) {
                Ok(bytes) => {
                    let _ = std::fs::remove_file(path);
                    json!({
                        "content": [
                            { "type": "image", "data": base64(&bytes), "mimeType": "image/jpeg" },
                            { "type": "text", "text": page_line(v) }
                        ]
                    })
                }
                Err(e) => text_result(format!("screenshot file unreadable: {e}"), true),
            }
        }
        "browser_scroll" => text_result(
            format!(
                "scrollY {} of {} (viewport {})",
                v.get("scrollY").unwrap_or(&Value::Null),
                v.get("scrollHeight").unwrap_or(&Value::Null),
                v.get("viewportHeight").unwrap_or(&Value::Null)
            ),
            false,
        ),
        _ => {
            let mut text = format!("done. now: {}", page_line(v));
            if let Some(el) = v.get("element").filter(|e| e.is_object()) {
                text = format!(
                    "{} on {}\n{text}",
                    name.trim_start_matches("browser_"),
                    element_line(el)
                );
            }
            text_result(text, false)
        }
    }
}

fn element_line(e: &Value) -> String {
    let mut line = format!(
        "[{}] {}",
        e.get("ref").unwrap_or(&Value::Null),
        s(e, "role")
    );
    let name = s(e, "name");
    if !name.is_empty() {
        line.push_str(&format!(" \"{name}\""));
    }
    if let Some(value) = e.get("value").and_then(Value::as_str) {
        line.push_str(&format!(" value=\"{value}\""));
    }
    if let Some(checked) = e.get("checked").and_then(Value::as_bool) {
        line.push_str(if checked {
            " [checked]"
        } else {
            " [unchecked]"
        });
    }
    if e.get("disabled").and_then(Value::as_bool) == Some(true) {
        line.push_str(" [disabled]");
    }
    if let Some(options) = e.get("options").and_then(Value::as_array) {
        let opts: Vec<&str> = options.iter().filter_map(Value::as_str).collect();
        line.push_str(&format!(" options: {}", opts.join(" | ")));
    }
    let href = s(e, "href");
    if !href.is_empty() {
        line.push_str(&format!(" -> {href}"));
    }
    line
}

fn render_snapshot(v: &Value) -> String {
    let mut out = format!(
        "Page: {}\nURL: {}\nTab: {}\n\nInteractive elements (use the number as `element`):\n",
        s(v, "title"),
        s(v, "url"),
        s(v, "tab")
    );
    let elements = v
        .get("elements")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if elements.is_empty() {
        out.push_str("(none)\n");
    }
    for e in &elements {
        out.push_str(&element_line(e));
        out.push('\n');
    }
    out.push_str("\nPage text:\n");
    out.push_str(s(v, "text"));
    if v.get("textTruncated").and_then(Value::as_bool) == Some(true) {
        out.push_str("\n...(truncated; raise max_text or scroll)");
    }
    out
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn every_tool_maps_to_a_control_method() {
        for tool in tools() {
            let name = tool["name"].as_str().unwrap();
            assert!(control_method(name).is_some(), "{name} has no method");
            assert!(tool["inputSchema"]["type"] == "object");
        }
    }

    #[test]
    fn initialize_echoes_protocol_and_lists_tools() {
        let init = handle("initialize", &json!({ "protocolVersion": "2025-03-26" })).unwrap();
        assert_eq!(init["protocolVersion"], "2025-03-26");
        assert_eq!(init["serverInfo"]["name"], "terax-browser");
        let list = handle("tools/list", &json!({})).unwrap();
        assert!(list["tools"].as_array().unwrap().len() >= 10);
        assert!(handle("nope", &json!({})).is_err());
    }

    #[test]
    fn snapshot_renders_numbered_elements() {
        let text = render_snapshot(&json!({
            "title": "登录", "url": "http://x/login", "tab": "web-1",
            "elements": [
                { "ref": 1, "role": "input:text", "name": "账号", "value": "admin" },
                { "ref": 2, "role": "button", "name": "登录" },
                { "ref": 3, "role": "link", "name": "帮助", "href": "/help" }
            ],
            "text": "欢迎", "textTruncated": false
        }));
        assert!(text.contains("[1] input:text \"账号\" value=\"admin\""));
        assert!(text.contains("[2] button \"登录\""));
        assert!(text.contains("[3] link \"帮助\" -> /help"));
        assert!(text.contains("Page text:\n欢迎"));
    }

    #[test]
    fn unknown_tool_is_an_error_result() {
        let out = call_tool("rm_rf", &json!({}));
        assert_eq!(out["isError"], true);
    }
}
