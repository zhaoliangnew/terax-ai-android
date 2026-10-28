//! Locating the Android SDK tools and running them with bounded time.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use crate::modules::lsp::env::server_env_overlay;

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };
const SCRIPT: &str = if cfg!(windows) { ".bat" } else { "" };

fn env_var(key: &str) -> Option<String> {
    server_env_overlay()
        .get(key)
        .cloned()
        .or_else(|| std::env::var(key).ok())
        .filter(|v| !v.trim().is_empty())
}

/// The SDK that owns `adb_path` (so emulator and adb versions match), falling
/// back to the usual env vars and install locations.
pub fn sdk_root(adb_path: &str) -> Option<PathBuf> {
    let from_adb = Path::new(adb_path)
        .canonicalize()
        .ok()
        .and_then(|p| Some(p.parent()?.parent()?.to_path_buf()));
    let home = dirs::home_dir();
    let candidates = [
        from_adb,
        env_var("ANDROID_HOME").map(PathBuf::from),
        env_var("ANDROID_SDK_ROOT").map(PathBuf::from),
        home.as_ref().map(|h| h.join("Library/Android/sdk")),
        home.as_ref().map(|h| h.join("Android/Sdk")),
        dirs::data_local_dir().map(|d| d.join("Android/Sdk")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| emulator_bin(p).is_file())
}

pub fn emulator_bin(sdk: &Path) -> PathBuf {
    sdk.join("emulator").join(format!("emulator{EXE}"))
}

/// cmdline-tools/latest first, then any other installed version.
pub fn cmdline_tool(sdk: &Path, tool: &str) -> Option<PathBuf> {
    let file = format!("{tool}{SCRIPT}");
    let base = sdk.join("cmdline-tools");
    let latest = base.join("latest").join("bin").join(&file);
    if latest.is_file() {
        return Some(latest);
    }
    let mut others: Vec<PathBuf> = std::fs::read_dir(&base)
        .ok()?
        .flatten()
        .map(|e| e.path().join("bin").join(&file))
        .filter(|p| p.is_file())
        .collect();
    others.sort();
    others.pop()
}

/// sdkmanager/avdmanager need Java 17+; GUI apps rarely see JAVA_HOME, and
/// Android Studio always ships a usable JBR.
pub fn java_home() -> Option<PathBuf> {
    let java = |home: &Path| home.join("bin").join(format!("java{EXE}")).is_file();
    let mut candidates: Vec<PathBuf> = env_var("JAVA_HOME")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    if cfg!(target_os = "macos") {
        candidates.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home".into());
        if let Some(h) = dirs::home_dir() {
            candidates.push(h.join("Applications/Android Studio.app/Contents/jbr/Contents/Home"));
        }
    } else if cfg!(windows) {
        candidates.push(r"C:\Program Files\Android\Android Studio\jbr".into());
    } else {
        candidates.push("/opt/android-studio/jbr".into());
        if let Some(h) = dirs::home_dir() {
            candidates.push(h.join("android-studio/jbr"));
        }
    }
    candidates.into_iter().find(|h| java(h))
}

pub fn avd_home() -> Option<PathBuf> {
    if let Some(p) = env_var("ANDROID_AVD_HOME") {
        return Some(PathBuf::from(p));
    }
    if let Some(p) = env_var("ANDROID_USER_HOME") {
        return Some(PathBuf::from(p).join("avd"));
    }
    Some(dirs::home_dir()?.join(".android").join("avd"))
}

pub fn command(bin: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(bin);
    crate::modules::proc::hide_console(&mut c);
    c.stdin(Stdio::null());
    c
}

/// Runs to completion with both pipes drained on threads, so chatty tools
/// can't deadlock on a full pipe while we wait.
pub fn run(mut cmd: Command, timeout: Duration, what: &str) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{what} 启动失败: {e}"))?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = drain(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{what} 超时({} 秒没完成)", timeout.as_secs()));
            }
            Err(e) => return Err(format!("{what} 失败: {e}")),
        }
    };
    Ok(Output {
        status,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

/// stdout+stderr as text, or an error carrying them when the exit code is bad.
pub fn run_ok(cmd: Command, timeout: Duration, what: &str) -> Result<String, String> {
    let out = run(cmd, timeout, what)?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        Ok(text)
    } else {
        Err(format!("{what} 失败: {}", tail(&text, 600)))
    }
}

pub fn tail(text: &str, max: usize) -> String {
    let t = text.trim();
    if t.len() <= max {
        return t.to_string();
    }
    let mut start = t.len() - max;
    while !t.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &t[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_respects_char_boundaries() {
        assert_eq!(tail("abc", 10), "abc");
        assert_eq!(tail("模拟器启动失败", 12), "…启动失败");
        assert_eq!(tail("模拟器启动失败", 7), "…失败");
    }

    #[test]
    fn run_drains_large_output_without_deadlock() {
        if cfg!(windows) {
            return;
        }
        let mut c = command("sh");
        c.args(["-c", "head -c 300000 /dev/zero | tr '\\0' x; echo done >&2"]);
        let out = run(c, Duration::from_secs(10), "test").unwrap();
        assert_eq!(out.stdout.len(), 300_000);
        assert_eq!(String::from_utf8_lossy(&out.stderr).trim(), "done");
    }

    #[test]
    fn run_times_out() {
        if cfg!(windows) {
            return;
        }
        let mut c = command("sleep");
        c.arg("5");
        let err = run(c, Duration::from_millis(200), "sleep").unwrap_err();
        assert!(err.contains("超时"));
    }
}
