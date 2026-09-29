//! Chat-view sessions driven by the Qoder CLI (`qoderclicn`). It speaks the
//! same stream-json + control protocol as Claude Code (`-p --input-format
//! stream-json --output-format stream-json --permission-prompt-tool stdio`),
//! so no sidecar is needed: Rust owns the process and translates between the
//! CLI and the event lines the Claude chat view already understands
//! (`{type:"sdk", msg}`, `permission_request`, `models`, `closed`).

use crate::modules::claude_chat::validate_host_line;
use crate::modules::lsp::env as login_env;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// A tool-permission question the CLI is waiting on: the original input
/// (echoed back on allow) and the "always allow" rules it suggested.
struct PendingAsk {
    input: Value,
    suggestions: Value,
}

struct Session {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, PendingAsk>>>,
    /// Model list from the `initialize` response, in the chat view's shape.
    models: Arc<Mutex<Option<Value>>>,
    /// Plan name and credits used so far, for the usage panel.
    usage: Arc<Mutex<QoderUsage>>,
    events: Channel<String>,
    next_req: u32,
}

/// What Qoder tells us about usage on this protocol: the plan (from the
/// `initialize` account info) and the session's running credit total (every
/// `result` carries it). There is no quota/percentage API in print mode.
#[derive(Default, Clone)]
pub struct QoderUsage {
    plan: Option<String>,
    credits: Option<f64>,
}

/// Usage in the shape the chat view's usage panel reads.
pub fn usage_event(u: &QoderUsage) -> Value {
    let mut notes = Vec::new();
    match u.credits {
        Some(c) => notes.push(format!("本次会话已用 {c:.1} credits")),
        None => notes.push("本次会话还没用 credits(发一条消息后再看)".to_string()),
    }
    notes.push("额度剩多少 Qoder 没提供,去 Qoder 客户端里看".to_string());
    json!({"type": "usage", "usage": {"subscriptionType": u.plan, "notes": notes}})
}

#[derive(Default)]
pub struct QoderChatState {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
}

impl QoderChatState {
    pub fn kill_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        for (_, mut s) in map.drain() {
            let _ = s.child.kill();
        }
    }
}

/// `qoderclicn` from the login-shell PATH, else its usual install spots.
fn qoder_binary() -> Option<PathBuf> {
    if let Some(p) = login_env::resolve_binary("qoderclicn") {
        return Some(p);
    }
    let home = dirs::home_dir()?;
    [".local/bin/qoderclicn", ".qoder-cn/bin/qoderclicn/qoderclicn"]
        .iter()
        .map(|rel| home.join(rel))
        .find(|p| p.is_file())
}

/// The chat view's permission modes (Claude's names) as the CLI flag wants them.
/// Plan has no startup flag; it is switched on over the control channel.
pub fn cli_permission_mode(mode: &str) -> &'static str {
    match mode {
        "acceptEdits" => "accept_edits",
        "bypassPermissions" => "bypass_permissions",
        _ => "default",
    }
}

/// `initialize` response models → `[{value, displayName, description}]`.
pub fn chat_models(init: &Value) -> Value {
    let list = init
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Value::Array(
        list.iter()
            .filter(|m| m.get("isEnabled").and_then(Value::as_bool) != Some(false))
            .filter_map(|m| {
                let value = m.get("value").and_then(Value::as_str)?;
                let name = m
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(value);
                let description = m.get("description").and_then(Value::as_str).unwrap_or("");
                Some(json!({ "value": value, "displayName": name, "description": description }))
            })
            .collect(),
    )
}

/// A user turn: the text, plus attached files named by path (Qoder reads
/// them itself with its Read tool).
pub fn user_message(text: &str, attachments: &[String]) -> Value {
    let mut body = text.to_string();
    if !attachments.is_empty() {
        if !body.is_empty() {
            body.push_str("\n\n");
        }
        body.push_str("附件:\n");
        for a in attachments {
            body.push_str("- ");
            body.push_str(a);
            body.push('\n');
        }
    }
    json!({ "type": "user", "message": { "role": "user", "content": body } })
}

fn write_line(stdin: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<(), String> {
    let mut w = stdin.lock().unwrap();
    writeln!(w, "{value}").map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

const INIT_REQUEST: &str = "terax-init";

/// One CLI stdout line → what the chat view gets (if anything).
fn translate(
    line: &str,
    stdin: &Arc<Mutex<ChildStdin>>,
    pending: &Arc<Mutex<HashMap<String, PendingAsk>>>,
    models: &Arc<Mutex<Option<Value>>>,
    usage: &Arc<Mutex<QoderUsage>>,
) -> Option<Value> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(Value::as_str) == Some("result") {
        if let Some(c) = v.get("total_credits").and_then(Value::as_f64) {
            usage.lock().unwrap().credits = Some(c);
        }
    }
    match v.get("type").and_then(Value::as_str) {
        Some("control_request") => {
            let id = v.get("request_id").and_then(Value::as_str)?.to_string();
            let req = v.get("request")?;
            if req.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
                // Hooks, MCP bridging…: nothing on our side handles those.
                let _ = write_line(
                    stdin,
                    &json!({"type": "control_response", "response": {
                        "subtype": "error", "request_id": id, "error": "not supported"}}),
                );
                return None;
            }
            let input = req.get("input").cloned().unwrap_or_else(|| json!({}));
            let suggestions = req
                .get("permission_suggestions")
                .cloned()
                .unwrap_or(Value::Null);
            let can_always = suggestions.as_array().is_some_and(|a| !a.is_empty());
            let tool = req
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let blocked = req.get("blocked_path").cloned().unwrap_or(Value::Null);
            pending.lock().unwrap().insert(
                id.clone(),
                PendingAsk {
                    input: input.clone(),
                    suggestions,
                },
            );
            Some(json!({
                "type": "permission_request", "id": id, "toolName": tool,
                "input": input, "blockedPath": blocked, "canAlways": can_always,
            }))
        }
        Some("control_response") => {
            let resp = v.get("response")?;
            if resp.get("request_id").and_then(Value::as_str) == Some(INIT_REQUEST) {
                let init = resp.get("response").unwrap_or(&Value::Null);
                usage.lock().unwrap().plan = init
                    .pointer("/account/subscriptionType")
                    .and_then(Value::as_str)
                    .map(String::from);
                let list = chat_models(init);
                *models.lock().unwrap() = Some(list.clone());
                return Some(json!({ "type": "models", "models": list }));
            }
            None
        }
        _ => Some(json!({ "type": "sdk", "msg": v })),
    }
}

#[tauri::command]
pub async fn qoder_chat_start(
    state: tauri::State<'_, QoderChatState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cwd: String,
    resume: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    on_event: Channel<String>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(None);
    let cwd = authorize_spawn_cwd(&registry, Some(cwd.as_str()), &workspace)?
        .ok_or("qoder chat: cwd is required")?;
    let sessions = Arc::clone(&state.sessions);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    tauri::async_runtime::spawn_blocking(move || {
        let bin = qoder_binary().ok_or("没找到 Qoder 命令行(qoderclicn),先安装 Qoder CLI")?;
        let mode = permission_mode.unwrap_or_else(|| "bypassPermissions".into());
        let mut cmd = Command::new(bin);
        cmd.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            cli_permission_mode(&mode),
        ]);
        if let Some(r) = resume.as_deref().filter(|r| !r.is_empty()) {
            cmd.args(["--resume", r]);
        }
        if let Some(m) = model.as_deref().filter(|m| !m.is_empty()) {
            cmd.args(["--model", m]);
        }
        let mut child = cmd
            .current_dir(&cwd)
            .envs(login_env::server_env_overlay())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("qoder chat: spawn failed: {e}"))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("qoder chat: no stdin")?));
        let stdout = child.stdout.take().ok_or("qoder chat: no stdout")?;
        let stderr = child.stderr.take().ok_or("qoder chat: no stderr")?;

        // Ask for the model list up front (it comes back on the init response).
        write_line(
            &stdin,
            &json!({"type": "control_request", "request_id": INIT_REQUEST,
                    "request": {"subtype": "initialize"}}),
        )?;
        if mode == "plan" {
            write_line(
                &stdin,
                &json!({"type": "control_request", "request_id": "terax-plan",
                        "request": {"subtype": "set_permission_mode", "mode": "plan"}}),
            )?;
        }

        // 最近几行错误输出:进程意外退出时带给界面,不然只看到"会话已结束"
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let err_tail = Arc::clone(&tail);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::info!("qoder chat {id}: {line}");
                // 技能覆盖提示每次启动都刷一屏,不是错误
                if line.starts_with("Skill \"") {
                    continue;
                }
                let mut t = err_tail.lock().unwrap();
                t.push(line);
                if t.len() > 8 {
                    t.remove(0);
                }
            }
        });
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let models = Arc::new(Mutex::new(None));
        let usage = Arc::new(Mutex::new(QoderUsage::default()));
        let reader_sessions = Arc::clone(&sessions);
        let (r_stdin, r_pending, r_models, r_usage, r_events) = (
            Arc::clone(&stdin),
            Arc::clone(&pending),
            Arc::clone(&models),
            Arc::clone(&usage),
            on_event.clone(),
        );
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(evt) = translate(&line, &r_stdin, &r_pending, &r_models, &r_usage) {
                    if r_events.send(evt.to_string()).is_err() {
                        break;
                    }
                }
            }
            let status = reader_sessions
                .lock()
                .unwrap()
                .remove(&id)
                .and_then(|mut s| s.child.wait().ok());
            log::info!("qoder chat {id} exited: {status:?}");
            if status.is_some_and(|st| !st.success()) {
                let detail = tail.lock().unwrap().join("\n");
                let msg = if detail.is_empty() {
                    format!("Qoder 退出了({})", status.unwrap())
                } else {
                    format!("Qoder 退出了:{detail}")
                };
                let _ = r_events.send(json!({"type": "error", "message": msg}).to_string());
            }
            let _ = r_events.send(r#"{"type":"closed"}"#.to_string());
        });

        sessions.lock().unwrap().insert(
            id,
            Session {
                child,
                stdin,
                pending,
                models,
                usage,
                events: on_event,
                next_req: 0,
            },
        );
        log::info!("qoder chat started id={id} cwd={}", cwd.display());
        Ok::<u32, String>(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn qoder_chat_send(
    state: tauri::State<'_, QoderChatState>,
    id: u32,
    line: String,
) -> Result<(), String> {
    let op: Value = serde_json::from_str(&validate_host_line(&line)?).map_err(|e| e.to_string())?;
    let mut map = state.sessions.lock().unwrap();
    let s = map.get_mut(&id).ok_or("qoder chat: session gone")?;
    let str_of = |k: &str| op.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mut control = |s: &mut Session, request: Value| {
        s.next_req += 1;
        let rid = format!("terax-{}", s.next_req);
        write_line(
            &s.stdin,
            &json!({"type": "control_request", "request_id": rid, "request": request}),
        )
    };
    match op.get("op").and_then(Value::as_str).unwrap_or("") {
        "send" => {
            let files: Vec<String> = op
                .get("attachments")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let text = str_of("text");
            if text.trim().is_empty() && files.is_empty() {
                return Ok(());
            }
            write_line(&s.stdin, &user_message(&text, &files))
        }
        "permission" => {
            let rid = str_of("id");
            let Some(ask) = s.pending.lock().unwrap().remove(&rid) else {
                return Ok(());
            };
            let allow = op.get("allow").and_then(Value::as_bool).unwrap_or(false);
            let always = op.get("always").and_then(Value::as_bool).unwrap_or(false);
            let decision = if allow {
                // AskUserQuestion 的回答由界面填进 updatedInput 带回来
                let input = op
                    .get("updatedInput")
                    .filter(|v| v.is_object())
                    .cloned()
                    .unwrap_or(ask.input);
                let mut d = json!({"behavior": "allow", "updatedInput": input});
                if always && !ask.suggestions.is_null() {
                    d["updatedPermissions"] = ask.suggestions;
                }
                d
            } else {
                let msg = op
                    .get("message")
                    .and_then(Value::as_str)
                    .filter(|m| !m.trim().is_empty())
                    .unwrap_or("用户拒绝了这次操作");
                json!({"behavior": "deny", "message": msg})
            };
            write_line(
                &s.stdin,
                &json!({"type": "control_response", "response": {
                    "subtype": "success", "request_id": rid, "response": decision}}),
            )
        }
        "interrupt" => control(s, json!({"subtype": "interrupt"})),
        "set_model" => control(s, json!({"subtype": "set_model", "model": str_of("model")})),
        "set_mode" => control(
            s,
            json!({"subtype": "set_permission_mode", "mode": str_of("mode")}),
        ),
        "models" => {
            let list = s.models.lock().unwrap().clone();
            if let Some(list) = list {
                let _ = s.events.send(json!({"type": "models", "models": list}).to_string());
            }
            Ok(())
        }
        "usage" => {
            let u = s.usage.lock().unwrap().clone();
            let _ = s.events.send(usage_event(&u).to_string());
            Ok(())
        }
        other => Err(format!("qoder chat: unsupported op {other}")),
    }
}

#[tauri::command]
pub fn qoder_chat_stop(state: tauri::State<'_, QoderChatState>, id: u32) {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_permission_modes_to_cli_flags() {
        assert_eq!(cli_permission_mode("bypassPermissions"), "bypass_permissions");
        assert_eq!(cli_permission_mode("acceptEdits"), "accept_edits");
        assert_eq!(cli_permission_mode("default"), "default");
        assert_eq!(cli_permission_mode("plan"), "default");
    }

    #[test]
    fn keeps_enabled_models_only() {
        let init = json!({"models": [
            {"value": "auto", "displayName": "Auto", "description": "", "isEnabled": true},
            {"value": "off", "displayName": "Off", "isEnabled": false},
            {"value": "q", "displayName": "Qwen"},
        ]});
        let list = chat_models(&init);
        let values: Vec<&str> = list
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["value"].as_str().unwrap())
            .collect();
        assert_eq!(values, vec!["auto", "q"]);
    }

    #[test]
    fn usage_reports_plan_and_credits() {
        let u = QoderUsage {
            plan: Some("Pro+".into()),
            credits: Some(2.91),
        };
        let e = usage_event(&u);
        assert_eq!(e["usage"]["subscriptionType"], "Pro+");
        assert_eq!(e["usage"]["notes"][0], "本次会话已用 2.9 credits");
    }

    #[test]
    fn names_attachments_in_the_message() {
        let m = user_message("看下", &["/a/b.png".into()]);
        assert_eq!(m["message"]["content"], "看下\n\n附件:\n- /a/b.png\n");
        let plain = user_message("hi", &[]);
        assert_eq!(plain["message"]["content"], "hi");
    }
}
