//! Android emulators that stand in for Leniu devices: list/start/stop AVDs,
//! clone a real device (system image, screen, model identity, serial ports)
//! into a new AVD, recreate its serial ports as ptys relayed to host TCP
//! ports, and simulate the weighing module on one of them.

pub mod profile;
pub mod scale;
mod sdk;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::Manager;

use profile::{DeviceFacts, PortMap, Profile, ScaleProtocol, PROFILE_FILE};

const LOG_FILE: &str = "terax-emulator.log";
const DEVICE_BRIDGE: &str = "/data/local/tmp/terax_pty_bridge";
const DEVICE_IDENTITY: &str = "/data/local/tmp/terax_identity.prop";
const SHORT: Duration = Duration::from_secs(15);

/// Process groups of emulators Terax started, stopped when Terax exits.
#[derive(Default)]
pub struct EmulatorState {
    groups: std::sync::Arc<std::sync::Mutex<Vec<u32>>>,
}

impl EmulatorState {
    /// Asks each emulator to shut down; it saves nothing (no snapshots) and
    /// exits on its own, so this doesn't block app exit.
    pub fn kill_all(&self) {
        for pid in self.groups.lock().unwrap().drain(..) {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
            #[cfg(windows)]
            {
                let mut c = sdk::command("taskkill");
                c.args(["/PID", &pid.to_string(), "/T", "/F"]);
                let _ = c.spawn();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvdInfo {
    name: String,
    display_name: String,
    api: Option<u32>,
    abi: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    profile: Option<Profile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningEmulator {
    serial: String,
    avd: Option<String>,
    booted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    sdk_root: Option<String>,
    /// Why cloning is unavailable (missing cmdline-tools / Java), if it is.
    create_blocker: Option<String>,
    host_abi: &'static str,
    avds: Vec<AvdInfo>,
    running: Vec<RunningEmulator>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    avd: Option<String>,
    ports: Vec<PortMap>,
    scale_port: Option<String>,
    scale_protocol: ScaleProtocol,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CreateEvent {
    Step { text: String },
    Progress { percent: u8, text: String },
    Done { avd: String, serial: String },
    Failed { message: String },
}

fn sdk_root(adb_path: &str) -> Result<PathBuf, String> {
    sdk::sdk_root(adb_path).ok_or_else(|| {
        "没找到 Android SDK 里的模拟器,先在 Android Studio 的 SDK Manager 里装 Android Emulator"
            .into()
    })
}

fn adb(adb_path: &str, serial: &str) -> Command {
    let mut c = sdk::command(adb_path);
    c.arg("-s").arg(serial);
    c
}

fn adb_shell(
    adb_path: &str,
    serial: &str,
    script: &str,
    timeout: Duration,
) -> Result<String, String> {
    let mut c = adb(adb_path, serial);
    c.arg("shell").arg(script);
    sdk::run_ok(c, timeout, "adb shell")
}

fn check_serial(serial: &str) -> Result<(), String> {
    if profile::is_emulator_serial(serial) {
        Ok(())
    } else {
        Err(format!("不是模拟器: {serial}"))
    }
}

fn check_avd_name(name: &str) -> Result<(), String> {
    if profile::is_valid_avd_name(name) {
        Ok(())
    } else {
        Err("模拟器名字只能用英文字母、数字和 . _ -".into())
    }
}

fn avd_dir(name: &str) -> Result<PathBuf, String> {
    check_avd_name(name)?;
    let home = sdk::avd_home().ok_or("找不到模拟器目录")?;
    let ini = std::fs::read_to_string(home.join(format!("{name}.ini"))).unwrap_or_default();
    let dir = profile::ini_get(&profile::parse_ini(&ini), "path")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(format!("{name}.avd")));
    if dir.join("config.ini").is_file() {
        Ok(dir)
    } else {
        Err(format!("模拟器 {name} 不存在"))
    }
}

fn read_profile(dir: &Path) -> Option<Profile> {
    let text = std::fs::read_to_string(dir.join(PROFILE_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_profile(dir: &Path, p: &Profile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(PROFILE_FILE), json).map_err(|e| format!("保存模拟器配置失败: {e}"))
}

fn patch_config(dir: &Path, entries: &[(String, String)]) -> Result<(), String> {
    if let Some((k, _)) = entries
        .iter()
        .find(|(k, v)| !profile::is_valid_ini_entry(k, v))
    {
        return Err(format!("配置项不合法: {k}"));
    }
    let path = dir.join("config.ini");
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读 config.ini 失败: {e}"))?;
    std::fs::write(&path, profile::patch_ini(&text, entries))
        .map_err(|e| format!("写 config.ini 失败: {e}"))
}

fn list_avds() -> Vec<AvdInfo> {
    let Some(home) = sdk::avd_home() else {
        return vec![];
    };
    let Ok(entries) = std::fs::read_dir(&home) else {
        return vec![];
    };
    let mut avds: Vec<AvdInfo> = entries
        .flatten()
        .filter_map(|e| {
            let name = e
                .file_name()
                .to_string_lossy()
                .strip_suffix(".ini")?
                .to_string();
            let dir = avd_dir(&name).ok()?;
            let cfg = profile::parse_ini(&std::fs::read_to_string(dir.join("config.ini")).ok()?);
            let get = |k: &str| profile::ini_get(&cfg, k);
            let sys = get("image.sysdir.1").and_then(profile::parse_sysdir);
            Some(AvdInfo {
                display_name: get("avd.ini.displayname").unwrap_or(&name).to_string(),
                api: sys.as_ref().map(|s| s.0),
                abi: sys
                    .map(|s| s.1)
                    .or_else(|| get("abi.type").map(str::to_string)),
                width: get("hw.lcd.width").and_then(|v| v.parse().ok()),
                height: get("hw.lcd.height").and_then(|v| v.parse().ok()),
                profile: read_profile(&dir),
                name,
            })
        })
        .collect();
    avds.sort_by(|a, b| a.name.cmp(&b.name));
    avds
}

fn running_emulators(adb_path: &str) -> Vec<RunningEmulator> {
    let mut c = sdk::command(adb_path);
    c.arg("devices");
    let Ok(out) = sdk::run_ok(c, SHORT, "adb devices") else {
        return vec![];
    };
    out.lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let serial = parts.next()?;
            (profile::is_emulator_serial(serial) && parts.next() == Some("device"))
                .then(|| serial.to_string())
        })
        .map(|serial| RunningEmulator {
            avd: emulator_avd_name(adb_path, &serial),
            booted: is_booted(adb_path, &serial),
            serial,
        })
        .collect()
}

fn emulator_avd_name(adb_path: &str, serial: &str) -> Option<String> {
    let mut c = adb(adb_path, serial);
    c.args(["emu", "avd", "name"]);
    let out = sdk::run_ok(c, Duration::from_secs(5), "adb emu").ok()?;
    let name = out.lines().next()?.trim().to_string();
    profile::is_valid_avd_name(&name).then_some(name)
}

fn is_booted(adb_path: &str, serial: &str) -> bool {
    adb_shell(
        adb_path,
        serial,
        "getprop sys.boot_completed",
        Duration::from_secs(5),
    )
    .is_ok_and(|o| o.trim() == "1")
}

fn create_blocker(sdk: &Path) -> Option<String> {
    if sdk::cmdline_tool(sdk, "sdkmanager").is_none()
        || sdk::cmdline_tool(sdk, "avdmanager").is_none()
    {
        return Some(
            "需要先在 Android Studio 的 SDK Manager 里装 Android SDK Command-line Tools".into(),
        );
    }
    if sdk::java_home().is_none() {
        return Some("没找到 Java 17+,装 Android Studio 或设置 JAVA_HOME".into());
    }
    None
}

#[tauri::command]
pub async fn emulator_overview(adb_path: String) -> Result<Overview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sdk = sdk::sdk_root(&adb_path);
        Overview {
            create_blocker: match &sdk {
                Some(s) => create_blocker(s),
                None => Some("没找到 Android SDK 里的模拟器".into()),
            },
            sdk_root: sdk.map(|p| p.to_string_lossy().into_owned()),
            host_abi: profile::host_abi(std::env::consts::ARCH),
            avds: list_avds(),
            running: running_emulators(&adb_path),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// In its own process group so it survives a Terax crash, but recorded in
/// `state` so a normal Terax exit shuts it down.
fn spawn_emulator(
    state: &EmulatorState,
    sdk: &Path,
    avd: &str,
    dir: &Path,
    writable: bool,
) -> Result<(), String> {
    let log =
        std::fs::File::create(dir.join(LOG_FILE)).map_err(|e| format!("创建日志失败: {e}"))?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let mut c = sdk::command(sdk::emulator_bin(sdk));
    // Headless: the screen is shown through Terax's mirror, so no extra
    // emulator window or Dock icon.
    c.args(["-avd", avd, "-no-boot-anim", "-no-window"]);
    if writable {
        // The cloned identity lives in /system/build.prop; snapshots can't
        // be combined with a writable system, so skip both load and save.
        c.args(["-writable-system", "-no-snapshot"]);
    }
    c.stdout(Stdio::from(log)).stderr(Stdio::from(log_err));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    let mut child = c.spawn().map_err(|e| format!("启动模拟器失败: {e}"))?;
    let pid = child.id();
    state.groups.lock().unwrap().push(pid);
    // The launcher execs into qemu, so this wait ends when the emulator does.
    let groups = state.groups.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        groups.lock().unwrap().retain(|p| *p != pid);
    });
    Ok(())
}

#[tauri::command]
pub async fn emulator_start(
    app: tauri::AppHandle,
    adb_path: String,
    avd: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sdk = sdk_root(&adb_path)?;
        let dir = avd_dir(&avd)?;
        if running_emulators(&adb_path)
            .iter()
            .any(|r| r.avd.as_deref() == Some(avd.as_str()))
        {
            return Err(format!("{avd} 已经在运行了"));
        }
        spawn_emulator(
            &app.state::<EmulatorState>(),
            &sdk,
            &avd,
            &dir,
            read_profile(&dir).is_some(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn emulator_stop(adb_path: String, serial: String) -> Result<(), String> {
    check_serial(&serial)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = adb(&adb_path, &serial);
        c.args(["emu", "kill"]);
        sdk::run_ok(c, SHORT, "关闭模拟器").map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn emulator_log_tail(avd: String) -> Result<String, String> {
    let dir = avd_dir(&avd)?;
    let text = std::fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default();
    Ok(sdk::tail(&text, 3000))
}

#[tauri::command]
pub fn emulator_set_scale(
    avd: String,
    scale_port: String,
    protocol: ScaleProtocol,
) -> Result<(), String> {
    let dir = avd_dir(&avd)?;
    let mut p = read_profile(&dir).ok_or("这台模拟器不是照真机建的,没有串口")?;
    if !p.serial_ports.contains(&scale_port) {
        return Err(format!("没有这个串口: {scale_port}"));
    }
    p.scale_port = Some(scale_port);
    p.scale_protocol = protocol;
    write_profile(&dir, &p)
}

#[tauri::command]
pub async fn emulator_delete(adb_path: String, avd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = avd_dir(&avd)?;
        if running_emulators(&adb_path)
            .iter()
            .any(|r| r.avd.as_deref() == Some(avd.as_str()))
        {
            return Err("先关掉这台模拟器再删".into());
        }
        let home = sdk::avd_home().ok_or("找不到模拟器目录")?;
        // Only ever remove an `.avd` directory, wherever its .ini points.
        if dir.extension().and_then(|e| e.to_str()) != Some("avd") {
            return Err(format!("模拟器目录不对,不删: {}", dir.display()));
        }
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败: {e}"))?;
        let _ = std::fs::remove_file(home.join(format!("{avd}.ini")));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn wait_root(adb_path: &str, serial: &str) -> Result<(), String> {
    let mut c = adb(adb_path, serial);
    c.arg("root");
    sdk::run_ok(c, SHORT, "adb root")?;
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if adb_shell(adb_path, serial, "id -u", Duration::from_secs(5))
            .is_ok_and(|o| o.trim() == "0")
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("拿不到 root,模拟器要用 Google APIs 镜像(不能是 Play Store 镜像)".into())
}

fn bridge_resource(app: &tauri::AppHandle, abi: &str) -> Result<PathBuf, String> {
    let abi = match abi {
        "arm64-v8a" | "x86_64" => abi,
        other => return Err(format!("不支持的模拟器架构: {other}")),
    };
    app.path()
        .resolve(
            format!("resources/pty-bridge/{abi}/pty_bridge"),
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("找不到串口转发程序: {e}"))
}

/// Recreates the profile's serial ports as ptys and forwards each one to its
/// host port. Safe to repeat: old bridges are killed first.
fn prepare(
    app: &tauri::AppHandle,
    adb_path: &str,
    serial: &str,
    rebuild: bool,
) -> Result<Prepared, String> {
    prepare_with(&|abi| bridge_resource(app, abi), adb_path, serial, rebuild)
}

fn prepare_with(
    bridge_for: &dyn Fn(&str) -> Result<PathBuf, String>,
    adb_path: &str,
    serial: &str,
    rebuild: bool,
) -> Result<Prepared, String> {
    let console = profile::console_port(serial).ok_or_else(|| format!("不是模拟器: {serial}"))?;
    let avd = emulator_avd_name(adb_path, serial);
    let p = avd
        .as_deref()
        .and_then(|a| avd_dir(a).ok())
        .and_then(|d| read_profile(&d));
    let Some(p) = p else {
        return Ok(Prepared {
            avd,
            ports: vec![],
            scale_port: None,
            scale_protocol: ScaleProtocol::default(),
        });
    };
    if let Some(bad) = p
        .serial_ports
        .iter()
        .find(|s| !profile::is_valid_serial_path(s))
    {
        return Err(format!("串口路径不合法: {bad}"));
    }
    if !is_booted(adb_path, serial) {
        return Err("模拟器还没启动完".into());
    }
    wait_root(adb_path, serial)?;
    let ports = profile::port_map(console, &p.serial_ports);
    // `-e` follows the symlink: a pty only exists while its bridge holds it,
    // so a dead bridge shows up as a dangling link.
    let check: String = ports
        .iter()
        .map(|m| format!("[ -e {0} ] || echo {0};", m.path))
        .collect();
    let bridges = adb_shell(adb_path, serial, "pidof terax_pty_bridge", SHORT)
        .map(|o| o.split_whitespace().count())
        .unwrap_or(0);
    let healthy = !rebuild
        && bridges == ports.len()
        && adb_shell(adb_path, serial, &check, SHORT).is_ok_and(|o| o.trim().is_empty());
    // Restarting live bridges briefly unlinks the ports; an app opening one in
    // that gap crashes, so keep them when they're all still up.
    if healthy {
        adb_shell(adb_path, serial, "setenforce 0", SHORT)?;
    } else {
        let abi = adb_shell(adb_path, serial, "getprop ro.product.cpu.abi", SHORT)?;
        let bridge = bridge_for(abi.trim())?;
        let mut push = adb(adb_path, serial);
        push.arg("push").arg(&bridge).arg(DEVICE_BRIDGE);
        sdk::run_ok(push, Duration::from_secs(30), "推送串口转发程序")?;

        // Apps can't open a pty created by root under enforcing SELinux.
        let mut script = format!(
            "setenforce 0; chmod 755 {DEVICE_BRIDGE}; for p in $(pidof terax_pty_bridge); do kill $p; done; sleep 0.3;"
        );
        for m in &ports {
            let name = m.path.trim_start_matches("/dev/");
            script.push_str(&format!(
                " nohup {DEVICE_BRIDGE} {} {} > /data/local/tmp/terax_pty_{name}.log 2>&1 < /dev/null &",
                m.path, m.device_port
            ));
        }
        adb_shell(adb_path, serial, &script, SHORT)?;
        std::thread::sleep(Duration::from_millis(500));
        let missing = adb_shell(adb_path, serial, &check, SHORT)?;
        if !missing.trim().is_empty() {
            return Err(format!(
                "这些串口没建起来: {}",
                missing.split_whitespace().collect::<Vec<_>>().join(" ")
            ));
        }
    }
    for m in &ports {
        let mut f = adb(adb_path, serial);
        f.arg("forward")
            .arg(format!("tcp:{}", m.host_port))
            .arg(format!("tcp:{}", m.device_port));
        sdk::run_ok(f, SHORT, "adb forward")?;
    }
    Ok(Prepared {
        avd,
        ports,
        scale_port: p
            .scale_port
            .or_else(|| profile::default_scale_port(&p.identity, &p.serial_ports)),
        scale_protocol: p.scale_protocol,
    })
}

#[tauri::command]
pub async fn emulator_prepare(
    app: tauri::AppHandle,
    adb_path: String,
    serial: String,
    rebuild: bool,
) -> Result<Prepared, String> {
    check_serial(&serial)?;
    tauri::async_runtime::spawn_blocking(move || prepare(&app, &adb_path, &serial, rebuild))
        .await
        .map_err(|e| e.to_string())?
}

fn probe(adb_path: &str, serial: &str) -> Result<DeviceFacts, String> {
    const SEP: &str = "@@terax@@";
    let parts = [
        "getprop ro.serialno",
        "getprop ro.build.version.sdk",
        "getprop ro.build.version.release",
        "getprop ro.product.cpu.abilist",
        "wm size",
        "wm density",
        "getprop ro.product.brand",
        "getprop ro.product.manufacturer",
        "getprop ro.product.model",
        "getprop ro.product.device",
        "getprop ro.product.name",
        "getprop ro.board.platform",
        "getprop ro.build.display.id",
        "ls /dev",
    ];
    let script = parts.join(&format!("; echo {SEP}; "));
    let out = adb_shell(adb_path, serial, &script, Duration::from_secs(20))?.replace('\r', "");
    let v: Vec<&str> = out.split(SEP).map(str::trim).collect();
    if v.len() != parts.len() {
        return Err("读取设备信息失败".into());
    }
    let api: u32 = v[1]
        .parse()
        .map_err(|_| format!("读不到系统版本: {}", v[1]))?;
    let (width, height) = profile::parse_wm_size(v[4]).ok_or("读不到屏幕分辨率")?;
    let prop = |s: &str| {
        if profile::is_valid_prop_value(s) {
            s.to_string()
        } else {
            String::new()
        }
    };
    Ok(DeviceFacts {
        sn: prop(v[0]),
        api,
        release: prop(v[2]),
        abis: v[3]
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        width,
        height,
        density: profile::parse_wm_density(v[5]).unwrap_or(160),
        identity: profile::Identity {
            brand: prop(v[6]),
            manufacturer: prop(v[7]),
            model: prop(v[8]),
            device: prop(v[9]),
            name: prop(v[10]),
            platform: prop(v[11]),
            display_id: prop(v[12]),
        },
        serial_ports: profile::parse_serial_ports(v[13]),
    })
}

#[tauri::command]
pub async fn emulator_probe(adb_path: String, serial: String) -> Result<DeviceFacts, String> {
    if profile::is_emulator_serial(&serial) {
        return Err("要选真机,不能照着模拟器建".into());
    }
    tauri::async_runtime::spawn_blocking(move || probe(&adb_path, &serial))
        .await
        .map_err(|e| e.to_string())?
}

struct Job<'a> {
    app: &'a tauri::AppHandle,
    adb: &'a str,
    sdk: &'a Path,
    events: &'a Channel<CreateEvent>,
}

impl Job<'_> {
    fn step(&self, text: &str) {
        let _ = self.events.send(CreateEvent::Step { text: text.into() });
    }

    fn wait_boot(&self, serial: &str) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(420);
        while Instant::now() < deadline {
            if is_booted(self.adb, serial) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        Err("模拟器 7 分钟内没启动完".into())
    }

    fn reboot(&self, serial: &str) -> Result<(), String> {
        let mut c = adb(self.adb, serial);
        c.arg("reboot");
        let _ = sdk::run(c, SHORT, "adb reboot");
        // Give adb a moment to see the device drop before polling boot again.
        std::thread::sleep(Duration::from_secs(5));
        self.wait_boot(serial)
    }

    fn install_image(&self, pkg: &str) -> Result<(), String> {
        let tool = sdk::cmdline_tool(self.sdk, "sdkmanager").ok_or("没装 Command-line Tools")?;
        let java = sdk::java_home().ok_or("没找到 Java 17+")?;
        let mut c = sdk::command(tool);
        c.arg(format!("--sdk_root={}", self.sdk.display()))
            .arg(pkg)
            .env("JAVA_HOME", java)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = c
            .spawn()
            .map_err(|e| format!("启动 sdkmanager 失败: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            // License prompts; extra answers are simply never read.
            let _ = stdin.write_all("y\n".repeat(20).as_bytes());
        }
        let err_buf = {
            let mut err = child.stderr.take();
            std::thread::spawn(move || {
                use std::io::Read;
                let mut s = String::new();
                if let Some(e) = err.as_mut() {
                    let _ = e.read_to_string(&mut s);
                }
                s
            })
        };
        let downloading = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let monitor = self.watch_download(downloading.clone());
        let mut log = String::new();
        if let Some(mut out) = child.stdout.take() {
            use std::io::Read;
            let mut line = Vec::new();
            let mut byte = [0u8; 4096];
            while let Ok(n) = out.read(&mut byte) {
                if n == 0 {
                    break;
                }
                for &b in &byte[..n] {
                    if b == b'\r' || b == b'\n' {
                        let text = String::from_utf8_lossy(&line).to_string();
                        // Without a TTY sdkmanager barely reports progress;
                        // the download is tracked by watch_download instead.
                        if profile::parse_sdk_progress(&text).is_none() && !text.trim().is_empty() {
                            log.push_str(&text);
                            log.push('\n');
                        }
                        line.clear();
                    } else {
                        line.push(b);
                    }
                }
            }
        }
        let status = child.wait().map_err(|e| e.to_string());
        downloading.store(false, std::sync::atomic::Ordering::Relaxed);
        let _ = monitor.join();
        let status = status?;
        let err = err_buf.join().unwrap_or_default();
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "下载系统镜像失败: {}",
                sdk::tail(&format!("{log}{err}"), 600)
            ))
        }
    }

    /// Polls the zip sdkmanager is downloading into `<sdk>/.temp` and reports
    /// size, speed and (once Google answers a HEAD request) a real percentage.
    fn watch_download(
        &self,
        running: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> std::thread::JoinHandle<()> {
        let temp = self.sdk.join(".temp");
        let events = self.events.clone();
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering;
            let mut total: Option<u64> = None;
            let mut asked_for: Option<String> = None;
            let mut last = (Instant::now(), 0u64);
            let mut speed = 0u64;
            while running.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(1));
                let Some((file, size)) = newest_zip(&temp) else {
                    continue;
                };
                if asked_for.as_deref() != Some(file.as_str()) {
                    asked_for = Some(file.clone());
                    total = remote_size(&file);
                }
                let elapsed = last.0.elapsed().as_secs_f64().max(0.5);
                let now_speed = (size.saturating_sub(last.1) as f64 / elapsed) as u64;
                speed = if speed == 0 {
                    now_speed
                } else {
                    (speed * 3 + now_speed) / 4
                };
                last = (Instant::now(), size);
                let (percent, text) = if total.is_some_and(|t| size >= t) {
                    (100, "下载完成,解压安装中…".to_string())
                } else {
                    profile::download_progress(size, total, speed)
                };
                let _ = events.send(CreateEvent::Progress { percent, text });
            }
        })
    }

    fn create_avd(&self, name: &str, pkg: &str) -> Result<(), String> {
        let tool = sdk::cmdline_tool(self.sdk, "avdmanager").ok_or("没装 Command-line Tools")?;
        let java = sdk::java_home().ok_or("没找到 Java 17+")?;
        let mut c = sdk::command(tool);
        c.args(["create", "avd", "-n", name, "-k", pkg])
            .env("JAVA_HOME", java)
            .env("ANDROID_SDK_ROOT", self.sdk)
            .stdin(Stdio::piped());
        let mut child = c
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("启动 avdmanager 失败: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            // "Do you wish to create a custom hardware profile? [no]"
            let _ = stdin.write_all(b"no\n");
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "创建模拟器失败: {}",
                sdk::tail(&String::from_utf8_lossy(&out.stderr), 600)
            ))
        }
    }

    fn wait_new_serial(&self, avd: &str) -> Result<String, String> {
        let deadline = Instant::now() + Duration::from_secs(240);
        while Instant::now() < deadline {
            if let Some(r) = running_emulators(self.adb)
                .into_iter()
                .find(|r| r.avd.as_deref() == Some(avd))
            {
                return Ok(r.serial);
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        let log = std::fs::read_to_string(avd_dir(avd)?.join(LOG_FILE)).unwrap_or_default();
        Err(format!("模拟器没起来: {}", sdk::tail(&log, 600)))
    }

    fn remount(&self, serial: &str) -> Result<(), String> {
        wait_root(self.adb, serial)?;
        let mut c = adb(self.adb, serial);
        c.arg("remount");
        let out = sdk::run(c, Duration::from_secs(60), "adb remount")?;
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        // First remount on a fresh AVD only disables verity and asks for a reboot.
        if text.to_ascii_lowercase().contains("reboot") {
            self.step("第一次挂载系统分区要重启一次…");
            self.reboot(serial)?;
            wait_root(self.adb, serial)?;
            let mut c = adb(self.adb, serial);
            c.arg("remount");
            sdk::run_ok(c, Duration::from_secs(60), "adb remount")?;
        } else if !out.status.success() {
            return Err(format!("系统分区挂载失败: {}", sdk::tail(&text, 400)));
        }
        Ok(())
    }

    fn apply_identity(&self, serial: &str, identity: &profile::Identity) -> Result<(), String> {
        let tmp = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
        std::fs::write(tmp.path(), profile::identity_block(identity)).map_err(|e| e.to_string())?;
        let mut push = adb(self.adb, serial);
        push.arg("push").arg(tmp.path()).arg(DEVICE_IDENTITY);
        sdk::run_ok(push, SHORT, "推送设备标识")?;
        let script = format!(
            "sed -i '/^{b}$/,/^{e}$/d' /system/build.prop && cat {DEVICE_IDENTITY} >> /system/build.prop && sync",
            b = profile::IDENTITY_BEGIN,
            e = profile::IDENTITY_END,
        );
        adb_shell(self.adb, serial, &script, SHORT).map(|_| ())
    }

    fn run(&self, source: &str, name: &str, display: &str) -> Result<String, String> {
        self.step("读取真机信息…");
        let facts = probe(self.adb, source)?;
        let abi = profile::host_abi(std::env::consts::ARCH);
        let pkg = profile::system_image_package(facts.api, abi);
        if !self
            .sdk
            .join(format!(
                "system-images/android-{}/google_apis/{abi}/system.img",
                facts.api
            ))
            .is_file()
        {
            self.step(&format!(
                "下载 Android {} 系统镜像(约 1.5 GB)…",
                facts.release
            ));
            self.install_image(&pkg)?;
        }
        self.step("创建模拟器…");
        self.create_avd(name, &pkg)?;
        let dir = avd_dir(name)?;
        patch_config(&dir, &profile::clone_config(&facts, display))?;
        let p = Profile {
            source_sn: facts.sn.clone(),
            source_label: display.to_string(),
            scale_port: profile::default_scale_port(&facts.identity, &facts.serial_ports),
            scale_protocol: ScaleProtocol::default(),
            identity: facts.identity.clone(),
            serial_ports: facts.serial_ports.clone(),
        };
        write_profile(&dir, &p)?;

        self.step("第一次启动模拟器…");
        spawn_emulator(
            &self.app.state::<EmulatorState>(),
            self.sdk,
            name,
            &dir,
            true,
        )?;
        let serial = self.wait_new_serial(name)?;
        self.wait_boot(&serial)?;
        self.step("挂载系统分区…");
        self.remount(&serial)?;
        self.step(&format!(
            "写入设备型号 {} · {}…",
            facts.identity.manufacturer, facts.identity.model
        ));
        self.apply_identity(&serial, &facts.identity)?;
        self.step("重启让型号生效…");
        self.reboot(&serial)?;
        self.step(&format!("建立 {} 个串口…", p.serial_ports.len()));
        prepare(self.app, self.adb, &serial, true)?;
        Ok(serial)
    }
}

fn newest_zip(dir: &Path) -> Option<(String, u64)> {
    let mut best: Option<(std::time::SystemTime, String, u64)> = None;
    for op in std::fs::read_dir(dir).ok()?.flatten() {
        for f in std::fs::read_dir(op.path()).into_iter().flatten().flatten() {
            let name = f.file_name().to_string_lossy().into_owned();
            let Ok(meta) = f.metadata() else { continue };
            if !name.ends_with(".zip") || !meta.is_file() {
                continue;
            }
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().is_none_or(|b| modified > b.0) {
                best = Some((modified, name, meta.len()));
            }
        }
    }
    best.map(|(_, n, s)| (n, s))
}

/// Size of a Google APIs system image zip, for a real percentage.
fn remote_size(file: &str) -> Option<u64> {
    if !file
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return None;
    }
    let url = format!("https://dl.google.com/android/repository/sys-img/google_apis/{file}");
    tauri::async_runtime::block_on(async {
        let resp = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .ok()?
            .head(url)
            .send()
            .await
            .ok()?;
        resp.status()
            .is_success()
            .then(|| resp.content_length())
            .flatten()
    })
}

#[tauri::command]
pub async fn emulator_create(
    app: tauri::AppHandle,
    adb_path: String,
    source_serial: String,
    name: String,
    display_name: String,
    on_event: Channel<CreateEvent>,
) -> Result<(), String> {
    check_avd_name(&name)?;
    if profile::is_emulator_serial(&source_serial) {
        return Err("要选真机,不能照着模拟器建".into());
    }
    if display_name.chars().count() > 60 || display_name.contains(['\n', '\r']) {
        return Err("显示名太长".into());
    }
    let sdk = sdk_root(&adb_path)?;
    if let Some(b) = create_blocker(&sdk) {
        return Err(b);
    }
    if avd_dir(&name).is_ok() {
        return Err(format!("已经有叫 {name} 的模拟器了"));
    }
    std::thread::Builder::new()
        .name("emulator-create".into())
        .spawn(move || {
            let job = Job {
                app: &app,
                adb: &adb_path,
                sdk: &sdk,
                events: &on_event,
            };
            let display = if display_name.trim().is_empty() {
                name.clone()
            } else {
                display_name.trim().to_string()
            };
            let event = match job.run(&source_serial, &name, &display) {
                Ok(serial) => CreateEvent::Done { avd: name, serial },
                Err(message) => CreateEvent::Failed { message },
            };
            let _ = on_event.send(event);
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
