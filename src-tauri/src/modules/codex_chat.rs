//! Codex chat-view sessions: one `codex app-server` per chat, the same
//! JSON-RPC-over-stdio protocol the Codex desktop app and IDE plugins use.
//! Rust owns the process and relays lines; the frontend speaks the protocol
//! (initialize, thread/start, turn/start, approvals).
//!
//! Runs the user's own `codex` from the login-shell PATH, so the login,
//! `~/.codex/config.toml`, MCP servers and session files are the ones the
//! terminal `codex` uses (a chat thread can be resumed there and vice versa).

use crate::modules::lsp::env as login_env;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// Requests the frontend may make. Everything else (fs/*, plugin/*,
/// account/*, ...) stays out of reach of the webview.
const CLIENT_METHODS: &[&str] = &[
    "initialize",
    "thread/start",
    "thread/resume",
    "turn/start",
    "turn/interrupt",
    "model/list",
    "thread/compact/start",
    "account/rateLimits/read",
];
/// Methods whose `cwd` param is pinned to the session's authorized cwd.
const CWD_METHODS: &[&str] = &["thread/start", "thread/resume", "turn/start"];

struct Session {
    child: Child,
    stdin: ChildStdin,
    cwd: PathBuf,
}

#[derive(Default)]
pub struct CodexChatState {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
}

impl CodexChatState {
    pub fn kill_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        for (_, mut s) in map.drain() {
            let _ = s.child.kill();
        }
    }
}

/// A frontend line must be one JSON-RPC message: an allowed request, the
/// `initialized` notification, or a response to a server request (approval).
/// Requests that carry a working directory get it pinned to `cwd`.
pub fn validate_client_line(line: &str, cwd: &Path) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(line).map_err(|e| format!("bad json: {e}"))?;
    let obj = value.as_object_mut().ok_or("not an object")?;
    match obj.get("method").and_then(Value::as_str) {
        Some("initialized") if !obj.contains_key("id") => {}
        Some(method) => {
            if !obj.contains_key("id") || !CLIENT_METHODS.contains(&method) {
                return Err(format!("method not allowed: {method}"));
            }
            if CWD_METHODS.contains(&method) {
                if let Some(params) = obj.get_mut("params").and_then(Value::as_object_mut) {
                    params.insert(
                        "cwd".into(),
                        Value::String(cwd.to_string_lossy().into_owned()),
                    );
                }
            }
        }
        None => {
            if !obj.contains_key("id") || !(obj.contains_key("result") || obj.contains_key("error"))
            {
                return Err("not a request or response".into());
            }
        }
    }
    Ok(value.to_string())
}

#[tauri::command]
pub async fn codex_chat_start(
    state: tauri::State<'_, CodexChatState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cwd: String,
    on_event: Channel<String>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(None);
    let cwd = authorize_spawn_cwd(&registry, Some(cwd.as_str()), &workspace)?
        .ok_or("codex chat: cwd is required")?;
    let sessions = Arc::clone(&state.sessions);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    tauri::async_runtime::spawn_blocking(move || {
        let codex = login_env::resolve_binary("codex").ok_or(
            "codex chat: Codex CLI not found. Install Codex CLI or add codex.exe to PATH, then restart Terax.",
        )?;
        let mut command = Command::new(codex);
        command
            .arg("app-server")
            .current_dir(&cwd)
            .envs(login_env::server_env_overlay())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::modules::proc::hide_console(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("codex chat: spawn failed: {e}"))?;
        let stdin = child.stdin.take().ok_or("codex chat: no stdin")?;
        let stdout = child.stdout.take().ok_or("codex chat: no stdout")?;
        let stderr = child.stderr.take().ok_or("codex chat: no stderr")?;

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::debug!("codex chat {id}: {line}");
            }
        });
        let reader_sessions = Arc::clone(&sessions);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if on_event.send(line).is_err() {
                    break;
                }
            }
            if let Some(mut s) = reader_sessions.lock().unwrap().remove(&id) {
                let _ = s.child.wait();
            }
            // Not JSON-RPC: the frontend's own end-of-stream marker.
            let _ = on_event.send(r#"{"terax":"closed"}"#.to_string());
        });

        log::info!("codex chat started id={id} cwd={}", cwd.display());
        sessions
            .lock()
            .unwrap()
            .insert(id, Session { child, stdin, cwd });
        Ok::<u32, String>(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn codex_chat_send(
    state: tauri::State<'_, CodexChatState>,
    id: u32,
    line: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().unwrap();
    let s = map.get_mut(&id).ok_or("codex chat: session gone")?;
    let line = validate_client_line(&line, &s.cwd)?;
    writeln!(s.stdin, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn codex_chat_stop(state: tauri::State<'_, CodexChatState>, id: u32) {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_protocol_subset_only() {
        let cwd = Path::new("/w");
        assert!(validate_client_line(r#"{"id":1,"method":"turn/start","params":{}}"#, cwd).is_ok());
        assert!(validate_client_line(r#"{"method":"initialized"}"#, cwd).is_ok());
        assert!(validate_client_line(r#"{"id":0,"result":{"decision":"accept"}}"#, cwd).is_ok());
        assert!(validate_client_line(r#"{"id":2,"method":"fs/remove","params":{}}"#, cwd).is_err());
        assert!(validate_client_line(r#"{"method":"turn/start"}"#, cwd).is_err());
        assert!(validate_client_line(r#"{"id":3}"#, cwd).is_err());
        assert!(validate_client_line("[]", cwd).is_err());
    }

    #[test]
    fn pins_cwd() {
        let out = validate_client_line(
            r#"{"id":1,"method":"thread/start","params":{"cwd":"/etc"}}"#,
            Path::new("/w"),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["params"]["cwd"], "/w");
        assert!(!out.contains('\n'));
    }
}
