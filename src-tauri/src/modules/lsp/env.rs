//! GUI-launched apps get a bare PATH on macOS, and servers like
//! typescript-language-server need the user's PATH themselves to find
//! `node`. Capture the login shell env once, reuse for detect and spawn.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[cfg(unix)]
const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Empty on Windows (full user env is inherited there) or if capture failed.
pub fn server_env_overlay() -> &'static HashMap<String, String> {
    static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    ENV.get_or_init(|| {
        #[cfg(unix)]
        {
            match capture_login_env() {
                Some(env) => env,
                None => {
                    log::warn!("lsp: login shell env capture failed, using process env");
                    HashMap::new()
                }
            }
        }
        #[cfg(windows)]
        {
            HashMap::new()
        }
    })
}

pub fn resolve_binary(command: &str) -> Option<PathBuf> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let path = server_env_overlay()
        .get("PATH")
        .cloned()
        .or_else(|| std::env::var("PATH").ok());
    which::which_in(command, path, cwd).ok().or_else(|| {
        #[cfg(windows)]
        {
            resolve_windows_codex(command)
        }
        #[cfg(not(windows))]
        {
            None
        }
    })
}

/// A GUI-launched Windows app may inherit a PATH that predates a Codex update
/// or omits the per-version directory added by the Codex installer. The CLI
/// installs versioned executables below this stable user-local directory, so
/// look there as a fallback without changing the environment of other tools.
#[cfg(windows)]
fn resolve_windows_codex(command: &str) -> Option<PathBuf> {
    let bin_dir = dirs::data_local_dir()?.join("OpenAI").join("Codex").join("bin");
    resolve_windows_codex_from(command, &bin_dir)
}

#[cfg(windows)]
fn resolve_windows_codex_from(command: &str, bin_dir: &Path) -> Option<PathBuf> {
    if !command.eq_ignore_ascii_case("codex") {
        return None;
    }
    let mut candidates: Vec<_> = std::fs::read_dir(bin_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("codex.exe"))
        .filter(|path| path.is_file())
        .collect();
    // A stable order makes selection deterministic when an older version is
    // still present alongside the current one.
    candidates.sort_by_key(|path| {
        (
            std::fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .ok(),
            path.clone(),
        )
    });
    candidates.pop()
}

#[cfg(unix)]
fn capture_login_env() -> Option<HashMap<String, String>> {
    use shared_child::SharedChild;
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::sync::Arc;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut cmd = Command::new(&shell);
    cmd.args(["-l", "-c", "/usr/bin/env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let child = Arc::new(SharedChild::spawn(&mut cmd).ok()?);
    let mut stdout = child.take_stdout()?;
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("terax-lsp-env-capture".into())
        .spawn(move || {
            let mut buf = Vec::with_capacity(8 * 1024);
            let _ = stdout.read_to_end(&mut buf);
            let _ = tx.send(buf);
        })
        .ok()?;

    let bytes = match rx.recv_timeout(CAPTURE_TIMEOUT) {
        Ok(b) => {
            let _ = child.wait();
            b
        }
        Err(_) => {
            log::warn!("lsp: login shell env capture timed out after {CAPTURE_TIMEOUT:?}");
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };

    let env: HashMap<String, String> = bytes
        .split(|&b| b == 0)
        .filter(|chunk| !chunk.is_empty())
        .filter_map(|chunk| {
            let s = std::str::from_utf8(chunk).ok()?;
            let (k, v) = s.split_once('=')?;
            if k.is_empty() {
                return None;
            }
            Some((k.to_string(), v.to_string()))
        })
        .collect();
    if env.is_empty() {
        return None;
    }
    Some(env)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn resolve_binary_finds_sh() {
        let p = resolve_binary("sh").expect("sh must resolve");
        assert!(p.is_absolute());
    }

    #[test]
    fn resolve_binary_rejects_empty_and_missing() {
        assert!(resolve_binary("").is_none());
        assert!(resolve_binary("   ").is_none());
        assert!(resolve_binary("terax-definitely-not-a-real-binary").is_none());
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    #[test]
    fn resolves_codex_from_versioned_install_directory() {
        let root = tempfile::tempdir().unwrap();
        let install = root.path().join("version-hash");
        std::fs::create_dir(&install).unwrap();
        let executable = install.join("codex.exe");
        std::fs::write(&executable, b"test").unwrap();

        assert_eq!(
            resolve_windows_codex_from("codex", root.path()),
            Some(executable)
        );
        assert!(resolve_windows_codex_from("node", root.path()).is_none());
    }
}
