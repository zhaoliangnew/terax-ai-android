//! Pure logic for emulators cloned from real devices: config.ini edits,
//! device probe parsing, the identity build.prop block and port mapping.

use serde::{Deserialize, Serialize};

pub const PROFILE_FILE: &str = "terax-profile.json";
pub const IDENTITY_BEGIN: &str = "# terax-identity-begin";
pub const IDENTITY_END: &str = "# terax-identity-end";
const MAX_SERIAL_PORTS: usize = 64;
const HOST_PORT_BASE: u16 = 5600;
const PORTS_PER_EMULATOR: u16 = 100;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub brand: String,
    pub manufacturer: String,
    pub model: String,
    pub device: String,
    pub name: String,
    pub platform: String,
    pub display_id: String,
}

impl Identity {
    /// (prop, value) pairs written to /system/build.prop; empty values are skipped.
    pub fn props(&self) -> Vec<(&'static str, &str)> {
        [
            ("ro.product.brand", self.brand.as_str()),
            ("ro.product.manufacturer", &self.manufacturer),
            ("ro.product.model", &self.model),
            ("ro.product.device", &self.device),
            ("ro.product.name", &self.name),
            ("ro.board.platform", &self.platform),
            ("ro.build.display.id", &self.display_id),
        ]
        .into_iter()
        .filter(|(_, v)| !v.is_empty())
        .collect()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScaleProtocol {
    Xyd1,
    #[default]
    Xyd2,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub source_sn: String,
    pub source_label: String,
    pub identity: Identity,
    pub serial_ports: Vec<String>,
    #[serde(default)]
    pub scale_port: Option<String>,
    #[serde(default)]
    pub scale_protocol: ScaleProtocol,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFacts {
    pub sn: String,
    pub api: u32,
    pub release: String,
    pub abis: Vec<String>,
    pub width: u32,
    pub height: u32,
    pub density: u32,
    pub identity: Identity,
    pub serial_ports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortMap {
    pub path: String,
    pub device_port: u16,
    pub host_port: u16,
}

pub fn parse_ini(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let (k, v) = l.split_once('=')?;
            let k = k.trim();
            (!k.is_empty() && !k.starts_with('#')).then(|| (k.to_string(), v.trim().to_string()))
        })
        .collect()
}

pub fn ini_get<'a>(entries: &'a [(String, String)], key: &str) -> Option<&'a str> {
    entries
        .iter()
        .rev()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// Rewrites existing keys in place (keeping line order) and appends new ones.
pub fn patch_ini(text: &str, entries: &[(String, String)]) -> String {
    let mut done = vec![false; entries.len()];
    let mut out: Vec<String> = text
        .lines()
        .map(|line| {
            let key = line.split_once('=').map(|(k, _)| k.trim());
            match key.and_then(|k| entries.iter().position(|(ek, _)| ek == k)) {
                Some(i) => {
                    done[i] = true;
                    format!("{}={}", entries[i].0, entries[i].1)
                }
                None => line.to_string(),
            }
        })
        .collect();
    for (i, (k, v)) in entries.iter().enumerate() {
        if !done[i] {
            out.push(format!("{k}={v}"));
        }
    }
    let mut s = out.join("\n");
    s.push('\n');
    s
}

pub fn is_valid_ini_entry(key: &str, value: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
        && value.len() <= 512
        && !value.contains(['\n', '\r'])
}

pub fn is_valid_avd_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !name.starts_with('.')
}

pub fn is_emulator_serial(serial: &str) -> bool {
    console_port(serial).is_some()
}

pub fn console_port(serial: &str) -> Option<u16> {
    serial.strip_prefix("emulator-")?.parse().ok()
}

/// AVD names only allow `[A-Za-z0-9._-]`: keep what fits, squash the rest.
pub fn suggest_avd_name(model: &str, api: u32) -> String {
    let mut base = String::new();
    for c in model.chars() {
        if c.is_ascii_alphanumeric() || c == '-' {
            base.push(c);
        } else if !base.ends_with('_') {
            base.push('_');
        }
    }
    let base = base.trim_matches('_');
    let base = if base.is_empty() { "Device" } else { base };
    let mut name = format!("Leniu_{base}_API{api}");
    name.truncate(64);
    name
}

pub fn host_abi(arch: &str) -> &'static str {
    if arch == "aarch64" {
        "arm64-v8a"
    } else {
        "x86_64"
    }
}

pub fn system_image_package(api: u32, abi: &str) -> String {
    format!("system-images;android-{api};google_apis;{abi}")
}

pub fn is_valid_system_image(pkg: &str) -> bool {
    let parts: Vec<&str> = pkg.split(';').collect();
    matches!(parts.as_slice(), ["system-images", api, "google_apis", abi]
        if api.strip_prefix("android-").is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
            && matches!(*abi, "arm64-v8a" | "x86_64"))
}

/// `system-images/android-31/google_apis/arm64-v8a/` -> (31, "arm64-v8a").
pub fn parse_sysdir(sysdir: &str) -> Option<(u32, String)> {
    let parts: Vec<&str> = sysdir
        .split(['/', '\\'])
        .filter(|p| !p.is_empty())
        .collect();
    let i = parts.iter().position(|p| p.starts_with("android-"))?;
    let api = parts[i].strip_prefix("android-")?.parse().ok()?;
    let abi = parts.get(i + 2)?.to_string();
    Some((api, abi))
}

/// `wm size` prints the physical size and, when set, an override that wins.
pub fn parse_wm_size(out: &str) -> Option<(u32, u32)> {
    let mut found = None;
    for line in out.lines() {
        if let Some((_, v)) = line.split_once(':') {
            if let Some((w, h)) = v.trim().split_once('x') {
                if let (Ok(w), Ok(h)) = (w.trim().parse(), h.trim().parse()) {
                    found = Some((w, h));
                }
            }
        }
    }
    found
}

pub fn parse_wm_density(out: &str) -> Option<u32> {
    out.lines()
        .rev()
        .find_map(|l| l.split_once(':')?.1.trim().parse().ok())
}

/// Serial device nodes from `ls /dev`: ttyS1, ttySMT6, ttyUSB0, ttyFIQ0...
pub fn parse_serial_ports(ls: &str) -> Vec<String> {
    let mut ports: Vec<String> = ls
        .split_whitespace()
        .filter(|n| {
            let Some(rest) = n.strip_prefix("tty") else {
                return false;
            };
            let letters = rest.trim_end_matches(|c: char| c.is_ascii_digit());
            !letters.is_empty()
                && letters.len() < rest.len()
                && letters.chars().all(|c| c.is_ascii_uppercase())
        })
        .map(|n| format!("/dev/{n}"))
        .collect();
    ports.sort_by_key(|p| natural_key(p));
    ports.dedup();
    ports.truncate(MAX_SERIAL_PORTS);
    ports
}

fn natural_key(path: &str) -> (String, u32) {
    let digits = path.len() - path.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    let (head, num) = path.split_at(path.len() - digits);
    (head.to_string(), num.parse().unwrap_or(0))
}

pub fn is_valid_serial_path(path: &str) -> bool {
    path.strip_prefix("/dev/tty")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric()))
}

pub fn is_valid_prop_value(v: &str) -> bool {
    v.len() <= 92 && !v.chars().any(|c| c.is_control())
}

/// Each running emulator gets its own block of host ports (emulator-5554 ->
/// 5601.., emulator-5556 -> 5701..) so two clones can run side by side.
pub fn port_map(console: u16, ports: &[String]) -> Vec<PortMap> {
    let slot = console.saturating_sub(5554) / 2;
    let base = HOST_PORT_BASE.saturating_add(slot.saturating_mul(PORTS_PER_EMULATOR));
    ports
        .iter()
        .take((PORTS_PER_EMULATOR - 1) as usize)
        .enumerate()
        .map(|(i, p)| PortMap {
            path: p.clone(),
            device_port: HOST_PORT_BASE + 1 + i as u16,
            host_port: base.saturating_add(1 + i as u16),
        })
        .collect()
}

/// The weight serial port the Leniu scale app picks for each mainboard.
pub fn default_scale_port(identity: &Identity, ports: &[String]) -> Option<String> {
    let m = identity.manufacturer.to_ascii_lowercase();
    let model = &identity.model;
    let preferred = match m.as_str() {
        "ys" if model.contains("3576") => "/dev/ttyS5",
        "ys" if model.contains("3568") => "/dev/ttyS9",
        "shimeta" if model.contains("3588") => "/dev/ttySMT6",
        "shimeta" if model.contains("3576") => "/dev/ttyS11",
        "shimeta" if model.contains("A733") => "/dev/ttyAS5",
        "shimeta" if model.contains("133") => "/dev/ttyS1",
        "shimeta" if model.contains("3568") => "/dev/ttySMT4",
        _ => "/dev/ttyS1",
    };
    ports
        .iter()
        .find(|p| *p == preferred)
        .or_else(|| ports.first())
        .cloned()
}

pub fn identity_block(identity: &Identity) -> String {
    let mut s = format!("{IDENTITY_BEGIN}\n");
    for (k, v) in identity.props() {
        s.push_str(&format!("{k}={v}\n"));
    }
    s.push_str(IDENTITY_END);
    s.push('\n');
    s
}

/// config.ini entries that make a fresh AVD look like the probed device.
pub fn clone_config(facts: &DeviceFacts, display_name: &str) -> Vec<(String, String)> {
    let landscape = facts.width > facts.height;
    [
        ("avd.ini.displayname", display_name.to_string()),
        ("hw.lcd.width", facts.width.to_string()),
        ("hw.lcd.height", facts.height.to_string()),
        ("hw.lcd.density", facts.density.to_string()),
        (
            "hw.initialOrientation",
            if landscape { "landscape" } else { "portrait" }.to_string(),
        ),
        ("hw.ramSize", "4096".to_string()),
        ("vm.heapSize", "512".to_string()),
        ("hw.keyboard", "yes".to_string()),
        ("hw.gpu.enabled", "yes".to_string()),
        ("hw.gpu.mode", "auto".to_string()),
        ("hw.camera.back", "emulated".to_string()),
        ("hw.camera.front", "none".to_string()),
        ("disk.dataPartition.size", "16G".to_string()),
        ("sdcard.size", "2048M".to_string()),
        ("showDeviceFrame", "no".to_string()),
        ("skin.name", format!("{}x{}", facts.width, facts.height)),
        ("skin.path", "_no_skin".to_string()),
        ("PlayStore.enabled", "no".to_string()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// sdkmanager draws `[====   ] 45% Downloading x.zip` with carriage returns.
pub fn parse_sdk_progress(line: &str) -> Option<(u8, String)> {
    let after = line.rsplit(']').next()?.trim();
    let (pct, text) = after.split_once('%')?;
    let pct: u8 = pct.trim().parse().ok()?;
    Some((pct.min(100), text.trim().to_string()))
}

/// Download progress line for the clone dialog; `total` is unknown until
/// the size query answers.
pub fn download_progress(done: u64, total: Option<u64>, bytes_per_sec: u64) -> (u8, String) {
    const MB: f64 = 1024.0 * 1024.0;
    let speed = if bytes_per_sec >= 1024 * 1024 {
        format!("{:.1} MB/s", bytes_per_sec as f64 / MB)
    } else {
        format!("{} KB/s", bytes_per_sec / 1024)
    };
    match total.filter(|t| *t > 0) {
        Some(t) => {
            let pct = ((done.min(t) * 100) / t) as u8;
            let eta = if bytes_per_sec > 0 && t > done {
                let secs = (t - done) / bytes_per_sec;
                if secs >= 60 {
                    format!(" · 还要约 {} 分钟", secs.div_ceil(60))
                } else {
                    format!(" · 还要约 {secs} 秒")
                }
            } else {
                String::new()
            };
            (
                pct,
                format!(
                    "已下载 {:.0} / {:.0} MB · {speed}{eta}",
                    done as f64 / MB,
                    t as f64 / MB
                ),
            )
        }
        None => (0, format!("已下载 {:.0} MB · {speed}", done as f64 / MB)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn patch_ini_replaces_in_place_and_appends() {
        let text = "a=1\nhw.camera.back=emulated\n# c=3\nb = 2\n";
        let out = patch_ini(
            text,
            &[
                ("hw.camera.back".into(), "webcam0".into()),
                ("b".into(), "9".into()),
                ("new.key".into(), "x".into()),
            ],
        );
        assert_eq!(out, "a=1\nhw.camera.back=webcam0\n# c=3\nb=9\nnew.key=x\n");
        let parsed = parse_ini(&out);
        assert_eq!(ini_get(&parsed, "hw.camera.back"), Some("webcam0"));
        assert_eq!(ini_get(&parsed, "c"), None);
    }

    #[test]
    fn ini_entry_validation_blocks_injection() {
        assert!(is_valid_ini_entry("hw.lcd.width", "1920"));
        assert!(!is_valid_ini_entry("hw.lcd.width", "1920\nhw.x=1"));
        assert!(!is_valid_ini_entry("a=b", "1"));
        assert!(!is_valid_ini_entry("", "1"));
    }

    #[test]
    fn avd_names() {
        assert!(is_valid_avd_name("Leniu_3588A_A12"));
        assert!(!is_valid_avd_name("../evil"));
        assert!(!is_valid_avd_name("出入库"));
        assert!(!is_valid_avd_name(".hidden"));
        assert_eq!(suggest_avd_name("CRKC-3588A", 31), "Leniu_CRKC-3588A_API31");
        assert_eq!(suggest_avd_name("秤 3588", 31), "Leniu_3588_API31");
        assert_eq!(suggest_avd_name("", 30), "Leniu_Device_API30");
        assert!(is_valid_avd_name(&suggest_avd_name(&"x".repeat(200), 31)));
    }

    #[test]
    fn emulator_serials() {
        assert_eq!(console_port("emulator-5554"), Some(5554));
        assert!(!is_emulator_serial("192.168.10.22:5555"));
        assert!(!is_emulator_serial("emulator-x"));
    }

    #[test]
    fn system_images() {
        let pkg = system_image_package(31, host_abi("aarch64"));
        assert_eq!(pkg, "system-images;android-31;google_apis;arm64-v8a");
        assert!(is_valid_system_image(&pkg));
        assert!(is_valid_system_image(&system_image_package(
            30,
            host_abi("x86_64")
        )));
        assert!(!is_valid_system_image(
            "system-images;android-31;google_apis;arm64-v8a;x"
        ));
        assert!(!is_valid_system_image("platforms;android-31"));
        assert!(!is_valid_system_image(
            "system-images;android-;google_apis;x86_64"
        ));
        assert_eq!(
            parse_sysdir("system-images/android-31/google_apis/arm64-v8a/"),
            Some((31, "arm64-v8a".into()))
        );
        assert_eq!(
            parse_sysdir(r"system-images\android-30\google_apis\x86_64\"),
            Some((30, "x86_64".into()))
        );
    }

    #[test]
    fn wm_output() {
        assert_eq!(
            parse_wm_size("Physical size: 1920x1080\n"),
            Some((1920, 1080))
        );
        assert_eq!(
            parse_wm_size("Physical size: 1080x1920\nOverride size: 720x1280\n"),
            Some((720, 1280))
        );
        assert_eq!(parse_wm_density("Physical density: 240\r\n"), Some(240));
        assert_eq!(parse_wm_size("error"), None);
    }

    #[test]
    fn serial_ports_from_ls() {
        let ls = "tty ttyS1 ttyS10 ttyS3 ttySMT6 ttyUSB0 ttyFIQ0 ttyp0 ttyS ttySMT1 null tty0";
        assert_eq!(
            parse_serial_ports(ls),
            s(&[
                "/dev/ttyFIQ0",
                "/dev/ttyS1",
                "/dev/ttyS3",
                "/dev/ttyS10",
                "/dev/ttySMT1",
                "/dev/ttySMT6",
                "/dev/ttyUSB0"
            ])
        );
        assert!(is_valid_serial_path("/dev/ttySMT6"));
        assert!(!is_valid_serial_path("/dev/ttyS1;rm"));
        assert!(!is_valid_serial_path("/sdcard/x"));
    }

    #[test]
    fn port_map_gives_each_emulator_its_own_block() {
        let ports = s(&["/dev/ttyS1", "/dev/ttySMT6"]);
        let a = port_map(5554, &ports);
        assert_eq!(
            a,
            vec![
                PortMap {
                    path: "/dev/ttyS1".into(),
                    device_port: 5601,
                    host_port: 5601
                },
                PortMap {
                    path: "/dev/ttySMT6".into(),
                    device_port: 5602,
                    host_port: 5602
                },
            ]
        );
        let b = port_map(5556, &ports);
        assert_eq!(b[0].host_port, 5701);
        assert_eq!(b[0].device_port, 5601);
        let many: Vec<String> = (0..200).map(|i| format!("/dev/ttyS{i}")).collect();
        assert_eq!(port_map(5554, &many).len(), 99);
    }

    #[test]
    fn scale_port_follows_mainboard() {
        let ports = s(&["/dev/ttyS1", "/dev/ttySMT4", "/dev/ttySMT6"]);
        let id = |m: &str, model: &str| Identity {
            manufacturer: m.into(),
            model: model.into(),
            ..Default::default()
        };
        assert_eq!(
            default_scale_port(&id("ShiMeta", "CRKC-3588A"), &ports).as_deref(),
            Some("/dev/ttySMT6")
        );
        assert_eq!(
            default_scale_port(&id("YS", "YS-3568"), &ports).as_deref(),
            Some("/dev/ttyS1")
        );
        assert_eq!(default_scale_port(&id("x", "y"), &[]), None);
    }

    #[test]
    fn identity_block_skips_empty_props() {
        let id = Identity {
            manufacturer: "ShiMeta".into(),
            model: "CRKC-3588A".into(),
            ..Default::default()
        };
        assert_eq!(
            identity_block(&id),
            "# terax-identity-begin\nro.product.manufacturer=ShiMeta\nro.product.model=CRKC-3588A\n# terax-identity-end\n"
        );
        assert!(is_valid_prop_value("CRKC-3588A"));
        assert!(!is_valid_prop_value("a\nro.debuggable=1"));
    }

    #[test]
    fn clone_config_matches_orientation() {
        let facts = DeviceFacts {
            sn: "x".into(),
            api: 31,
            release: "12".into(),
            abis: s(&["arm64-v8a"]),
            width: 1920,
            height: 1080,
            density: 240,
            identity: Identity::default(),
            serial_ports: vec![],
        };
        let cfg = clone_config(&facts, "出入库秤");
        assert_eq!(ini_get(&cfg, "hw.initialOrientation"), Some("landscape"));
        assert_eq!(ini_get(&cfg, "skin.name"), Some("1920x1080"));
        assert!(cfg.iter().all(|(k, v)| is_valid_ini_entry(k, v)));
    }

    #[test]
    fn download_progress_text() {
        let mb = 1024 * 1024;
        assert_eq!(
            download_progress(54 * mb, Some(1200 * mb), 200 * 1024),
            (4, "已下载 54 / 1200 MB · 200 KB/s · 还要约 98 分钟".into())
        );
        assert_eq!(
            download_progress(1190 * mb, Some(1200 * mb), 2 * mb),
            (99, "已下载 1190 / 1200 MB · 2.0 MB/s · 还要约 5 秒".into())
        );
        assert_eq!(
            download_progress(10 * mb, None, 0),
            (0, "已下载 10 MB · 0 KB/s".into())
        );
        assert_eq!(download_progress(10, Some(0), 0).0, 0);
    }

    #[test]
    fn sdk_progress() {
        assert_eq!(
            parse_sdk_progress("[=======                ] 45% Downloading x.zip"),
            Some((45, "Downloading x.zip".into()))
        );
        assert_eq!(parse_sdk_progress("Warning: foo"), None);
    }

    #[test]
    fn profile_json_defaults_scale_fields() {
        let json = r#"{"sourceSn":"a","sourceLabel":"b","identity":{"brand":"","manufacturer":"","model":"","device":"","name":"","platform":"","displayId":""},"serialPorts":["/dev/ttyS1"]}"#;
        let p: Profile = serde_json::from_str(json).unwrap();
        assert_eq!(p.scale_protocol, ScaleProtocol::Xyd2);
        assert_eq!(p.scale_port, None);
    }
}
