//! Chat-view sessions: one Node sidecar per chat (`bridge/claude/bridge.mjs`)
//! that drives Claude Code through the Claude Agent SDK. Rust only owns the
//! process and relays newline-delimited JSON; the frontend renders SDK
//! messages and answers permission requests.
//!
//! The sidecar runs the user's own `claude` and `node` (resolved from the
//! login-shell PATH), so logins, settings, CLAUDE.md and MCP servers are the
//! same ones the terminal session uses.

use crate::modules::lsp::env as login_env;
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// Ops the frontend may send to the bridge. `start` is Rust's own.
const HOST_OPS: &[&str] = &[
    "send",
    "permission",
    "interrupt",
    "set_model",
    "set_mode",
    "models",
    "usage",
];

struct Session {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct ClaudeChatState {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
}

impl ClaudeChatState {
    pub fn kill_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        for (_, mut s) in map.drain() {
            let _ = s.child.kill();
        }
    }
}

/// A frontend line must be one JSON object whose `op` is in [`HOST_OPS`];
/// returns it re-serialized so nothing but that single object reaches stdin.
pub fn validate_host_line(line: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("bad json: {e}"))?;
    let op = value
        .get("op")
        .and_then(|v| v.as_str())
        .ok_or("missing op")?;
    if !HOST_OPS.contains(&op) {
        return Err(format!("op not allowed: {op}"));
    }
    Ok(value.to_string())
}

/// The installed app ships a single-file bundle of the sidecar
/// (`pnpm build:bridge`, see tauri.conf.json resources), so it runs on a
/// machine without the repo. A dev build uses the script in the checkout
/// instead: the bundle there may be stale.
fn bridge_script(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("bridge")
        .join("claude")
        .join("bridge.mjs");
    if cfg!(debug_assertions) && repo.is_file() {
        return Ok(repo);
    }
    let bundled = app.path().resolve(
        "claude-bridge/bridge.mjs",
        tauri::path::BaseDirectory::Resource,
    );
    match bundled {
        Ok(p) if p.is_file() => Ok(p),
        _ if repo.is_file() => Ok(repo),
        _ => Err("claude bridge not found in the app bundle".into()),
    }
}

#[tauri::command]
pub async fn claude_chat_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ClaudeChatState>,
    registry: tauri::State<'_, WorkspaceRegistry>,
    cwd: String,
    resume: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    on_event: Channel<String>,
) -> Result<u32, String> {
    let workspace = WorkspaceEnv::from_option(None);
    let cwd = authorize_spawn_cwd(&registry, Some(cwd.as_str()), &workspace)?
        .ok_or("claude chat: cwd is required")?;
    let script = bridge_script(&app)?;
    let sessions = Arc::clone(&state.sessions);
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    tauri::async_runtime::spawn_blocking(move || {
        let node = login_env::resolve_binary("node").ok_or("claude chat: node not found")?;
        let claude = login_env::resolve_binary("claude");
        let mut child = Command::new(node)
            .arg(&script)
            .current_dir(&cwd)
            .envs(login_env::server_env_overlay())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("claude chat: spawn failed: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("claude chat: no stdin")?;
        let stdout = child.stdout.take().ok_or("claude chat: no stdout")?;
        let stderr = child.stderr.take().ok_or("claude chat: no stderr")?;

        let start = serde_json::json!({
            "op": "start",
            "cwd": cwd.to_string_lossy(),
            "resume": resume,
            "model": model,
            "permissionMode": permission_mode,
            "claudePath": claude.map(|p| p.to_string_lossy().into_owned()),
        });
        writeln!(stdin, "{start}").map_err(|e| e.to_string())?;

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::debug!("claude chat {id}: {line}");
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
            let _ = on_event.send(r#"{"type":"closed"}"#.to_string());
        });

        sessions
            .lock()
            .unwrap()
            .insert(id, Session { child, stdin });
        log::info!("claude chat started id={id} cwd={}", cwd.display());
        Ok::<u32, String>(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn claude_chat_send(
    state: tauri::State<'_, ClaudeChatState>,
    id: u32,
    line: String,
) -> Result<(), String> {
    let line = validate_host_line(&line)?;
    let mut map = state.sessions.lock().unwrap();
    let s = map.get_mut(&id).ok_or("claude chat: session gone")?;
    writeln!(s.stdin, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn claude_chat_stop(state: tauri::State<'_, ClaudeChatState>, id: u32) {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
}

/// Parse `choose file` output: one POSIX path per line, blanks dropped.
pub fn parse_picked_paths(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
}

/// System file picker for chat attachments (any file on disk, not just the
/// project). macOS only for now: AppleScript's `choose file`, no extra deps.
/// Cancelling returns an empty list.
#[tauri::command]
pub async fn chat_pick_files() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let script = r#"set picked to choose file with prompt "选择要发给 Claude 的文件" with multiple selections allowed
set out to ""
repeat with f in picked
    set out to out & POSIX path of f & linefeed
end repeat
return out"#;
            let output = Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output()
                .map_err(|e| format!("file picker: {e}"))?;
            if !output.status.success() {
                // -128 = user cancelled
                return Ok(Vec::new());
            }
            Ok(parse_picked_paths(&String::from_utf8_lossy(&output.stdout)))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("file picker is only implemented on macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_known_ops_only() {
        assert!(validate_host_line(r#"{"op":"send","text":"hi"}"#).is_ok());
        assert!(validate_host_line(r#"{"op":"permission","id":"1","allow":true}"#).is_ok());
        assert!(validate_host_line(r#"{"op":"start","cwd":"/"}"#).is_err());
        assert!(validate_host_line(r#"{"text":"no op"}"#).is_err());
        assert!(validate_host_line("not json").is_err());
    }

    #[test]
    fn parses_picked_paths() {
        assert_eq!(
            parse_picked_paths("/a/b.png\n/c d/e.txt\n\n"),
            vec!["/a/b.png".to_string(), "/c d/e.txt".to_string()]
        );
        assert!(parse_picked_paths("").is_empty());
    }

    #[test]
    fn reserializes_to_a_single_line() {
        let out = validate_host_line("{\"op\":\"send\",\n\"text\":\"a\\nb\"}").unwrap();
        assert!(!out.contains('\n'));
    }
}
