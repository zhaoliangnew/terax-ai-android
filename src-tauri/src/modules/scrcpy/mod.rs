//! Minimal scrcpy v4.1 client: video (H.264 Annex-B) + control (touch/keys).
//! Pushes the bundled scrcpy-server, starts it via app_process, connects the
//! video + control sockets over an adb forward, demuxes the video stream and
//! forwards Annex-B packets to the webview via a Channel; writes control
//! messages back to the device.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::ipc::{Channel, Response};
use tauri::Manager;

const SERVER_VERSION: &str = "4.1";
const DEVICE_SERVER_PATH: &str = "/data/local/tmp/scrcpy-server.jar";

pub struct ScrcpyState {
    next_id: AtomicU32,
    sessions: RwLock<HashMap<u32, Session>>,
}

impl Default for ScrcpyState {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

struct Session {
    serial: String,
    adb_path: String,
    display_id: u32,
    local_port: u16,
    shell: Arc<Mutex<Child>>,
    control: Arc<Mutex<TcpStream>>,
    stop: Arc<AtomicBool>,
    /// Current video frame size, kept in sync with session packets.
    size: Arc<RwLock<(u16, u16)>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum VideoEvent {
    /// New encoding session — width/height of the frames that follow.
    Size { width: u16, height: u16 },
    /// Codec config (SPS/PPS) or a media packet. `payload` carried as the
    /// Channel's binary body; this JSON rides alongside via a small header.
    Meta {
        config: bool,
        key_frame: bool,
        pts: u64,
        len: u32,
    },
    Error {
        message: String,
    },
    Ended,
}

fn adb(bin: &str, serial: &str) -> Command {
    let mut c = Command::new(bin);
    c.arg("-s").arg(serial);
    c
}

fn read_exact(stream: &mut TcpStream, buf: &mut [u8]) -> std::io::Result<()> {
    stream.read_exact(buf)
}

#[tauri::command]
pub async fn scrcpy_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ScrcpyState>,
    serial: String,
    adb_path: String,
    max_size: Option<u16>,
    display_id: Option<u32>,
    on_video: Channel<Response>,
) -> Result<u32, String> {
    let display = display_id.unwrap_or(0);
    // Only one mirror per (device, display): tear down any existing session on
    // the same display first (its encoder must be free before we start). A
    // different display on the same device is a separate encoder — keep it.
    {
        let stale: Vec<u32> = state
            .sessions
            .read()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.serial == serial && s.display_id == display)
            .map(|(id, _)| *id)
            .collect();
        for id in stale {
            if let Some(s) = state.sessions.write().unwrap().remove(&id) {
                teardown(&s);
            }
        }
    }

    let server_path = app
        .path()
        .resolve(
            "resources/scrcpy-server-v4.1",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve server jar: {e}"))?;

    // Push server.
    let push = adb(&adb_path, &serial)
        .arg("push")
        .arg(&server_path)
        .arg(DEVICE_SERVER_PATH)
        .output()
        .map_err(|e| format!("adb push failed: {e}"))?;
    if !push.status.success() {
        return Err(format!(
            "adb push failed: {}",
            String::from_utf8_lossy(&push.stderr)
        ));
    }

    let scid: u32 = {
        // 31-bit non-negative id (server parses as signed int, base 16).
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        (nanos ^ 0x5bd1_e995) & 0x7fff_ffff
    };
    let socket_name = format!("scrcpy_{scid:08x}");

    // Pick a free local port and set up the forward.
    let local_port = pick_local_port().ok_or("no free local port")?;
    let fwd = adb(&adb_path, &serial)
        .arg("forward")
        .arg(format!("tcp:{local_port}"))
        .arg(format!("localabstract:{socket_name}"))
        .output()
        .map_err(|e| format!("adb forward failed: {e}"))?;
    if !fwd.status.success() {
        return Err(format!(
            "adb forward failed: {}",
            String::from_utf8_lossy(&fwd.stderr)
        ));
    }

    // Launch the server.
    let mut server_args = vec![
        format!("CLASSPATH={DEVICE_SERVER_PATH}"),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        SERVER_VERSION.into(),
        format!("scid={scid:08x}"),
        "log_level=info".into(),
        "audio=false".into(),
        "tunnel_forward=true".into(),
        "clipboard_autosync=false".into(),
    ];
    if let Some(ms) = max_size {
        server_args.push(format!("max_size={ms}"));
    }
    if display != 0 {
        server_args.push(format!("display_id={display}"));
    }
    let shell = adb(&adb_path, &serial)
        .arg("shell")
        .args(&server_args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn server failed: {e}"))?;

    // Connect video then control (order fixed by server accept()).
    // The forward-tunnel dummy byte is sent only on the FIRST (video) socket,
    // so peek-confirm the server on video, then plain-connect control.
    let video = connect_retry(local_port).map_err(|e| {
        let _ = adb(&adb_path, &serial)
            .args(["forward", "--remove", &format!("tcp:{local_port}")])
            .output();
        format!("connect video socket: {e}")
    })?;
    let control =
        connect_plain(local_port).map_err(|e| format!("connect control socket: {e}"))?;
    control.set_nodelay(true).ok();

    // Tunnel no longer needed once both sockets are up.
    let _ = adb(&adb_path, &serial)
        .args(["forward", "--remove", &format!("tcp:{local_port}")])
        .output();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let size = Arc::new(RwLock::new((0u16, 0u16)));

    let session = Session {
        serial: serial.clone(),
        adb_path: adb_path.clone(),
        display_id: display,
        local_port,
        shell: Arc::new(Mutex::new(shell)),
        control: Arc::new(Mutex::new(control)),
        stop: stop.clone(),
        size: size.clone(),
    };
    state.sessions.write().unwrap().insert(id, session);

    // Video demux thread.
    let stop_v = stop.clone();
    let size_v = size.clone();
    std::thread::Builder::new()
        .name(format!("scrcpy-video-{id}"))
        .spawn(move || {
            if let Err(e) = demux_video(video, on_video.clone(), stop_v, size_v) {
                let _ = on_video.send(Response::new(
                    serde_json::to_vec(&VideoEvent::Error { message: e }).unwrap_or_default(),
                ));
            }
            let _ = on_video.send(Response::new(
                serde_json::to_vec(&VideoEvent::Ended).unwrap_or_default(),
            ));
        })
        .map_err(|e| e.to_string())?;

    log::info!("scrcpy started id={id} serial={serial} port={local_port}");
    Ok(id)
}

/// Video framing: emit each event as a Channel binary message whose first 4
/// bytes are a little-endian JSON header length, then the JSON header, then the
/// raw payload. The webview splits it back apart.
fn demux_video(
    mut video: TcpStream,
    on_video: Channel<Response>,
    stop: Arc<AtomicBool>,
    size: Arc<RwLock<(u16, u16)>>,
) -> Result<(), String> {
    video
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;

    // Dummy byte (forward tunnel, first socket).
    let mut dummy = [0u8; 1];
    read_exact(&mut video, &mut dummy).map_err(|e| format!("dummy byte: {e}"))?;

    // 64-byte device name.
    let mut name = [0u8; 64];
    read_exact(&mut video, &mut name).map_err(|e| format!("device name: {e}"))?;

    // 4-byte codec id.
    let mut codec = [0u8; 4];
    read_exact(&mut video, &mut codec).map_err(|e| format!("codec id: {e}"))?;
    let codec_id = u32::from_be_bytes(codec);
    if codec_id == 0x0000_0000 {
        return Err("video stream disabled by device".into());
    }
    if codec_id == 0x0000_0001 {
        return Err("device reported video configuration error".into());
    }
    // 0x68323634 == "h264"
    if codec_id != 0x6832_3634 {
        return Err(format!("unexpected codec id {codec_id:#010x}"));
    }

    // No read timeout for the streaming loop (frames can be sparse on a still
    // screen); rely on the stop flag + socket shutdown to end.
    video.set_read_timeout(None).ok();

    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let mut header = [0u8; 12];
        if let Err(e) = read_exact(&mut video, &mut header) {
            if stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            return Err(format!("read header: {e}"));
        }

        if header[0] & 0x80 != 0 {
            // Session packet: width/height in bytes 4..12.
            let width = u32::from_be_bytes([header[4], header[5], header[6], header[7]]) as u16;
            let height = u32::from_be_bytes([header[8], header[9], header[10], header[11]]) as u16;
            *size.write().unwrap() = (width, height);
            send_event(&on_video, VideoEvent::Size { width, height }, &[]);
            continue;
        }

        // Media packet.
        let pts_flags = u64::from_be_bytes([
            header[0], header[1], header[2], header[3], header[4], header[5], header[6], header[7],
        ]);
        let config = pts_flags & (1 << 62) != 0;
        let key_frame = pts_flags & (1 << 61) != 0;
        let pts = pts_flags & ((1 << 61) - 1);
        let len = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
        if len == 0 {
            return Err("zero-length media packet".into());
        }
        let mut payload = vec![0u8; len as usize];
        read_exact(&mut video, &mut payload).map_err(|e| format!("read payload: {e}"))?;
        send_event(
            &on_video,
            VideoEvent::Meta {
                config,
                key_frame,
                pts,
                len,
            },
            &payload,
        );
    }
}

fn send_event(ch: &Channel<Response>, ev: VideoEvent, payload: &[u8]) {
    let header = serde_json::to_vec(&ev).unwrap_or_default();
    let mut buf = Vec::with_capacity(4 + header.len() + payload.len());
    buf.extend_from_slice(&(header.len() as u32).to_le_bytes());
    buf.extend_from_slice(&header);
    buf.extend_from_slice(payload);
    let _ = ch.send(Response::new(buf));
}

fn pick_local_port() -> Option<u16> {
    use std::net::TcpListener;
    for port in 27183..=27199 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    // Fall back to any free port.
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

fn connect_retry(port: u16) -> Result<TcpStream, String> {
    for _ in 0..100 {
        if let Ok(s) = TcpStream::connect(("127.0.0.1", port)) {
            // Peek 1 byte: EOF means server not up yet — retry.
            s.set_read_timeout(Some(Duration::from_millis(500))).ok();
            let mut b = [0u8; 1];
            match s.peek(&mut b) {
                Ok(1) => {
                    s.set_read_timeout(None).ok();
                    return Ok(s);
                }
                _ => {
                    drop(s);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("timed out waiting for server".into())
}

/// Second socket (control): server writes nothing on connect, so just connect
/// — retry a few times in case it races the server's accept() loop.
fn connect_plain(port: u16) -> Result<TcpStream, String> {
    let mut last = String::new();
    for _ in 0..50 {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(s) => return Ok(s),
            Err(e) => last = e.to_string(),
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(last)
}

#[tauri::command]
pub fn scrcpy_touch(
    state: tauri::State<'_, ScrcpyState>,
    id: u32,
    action: u8,
    x: i32,
    y: i32,
    pressure: f32,
) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let session = sessions.get(&id).ok_or("session not found")?;
    let (w, h) = *session.size.read().unwrap();
    if w == 0 || h == 0 {
        return Ok(()); // no frame yet; nothing to map against
    }
    let mut msg = [0u8; 32];
    msg[0] = 0x02; // INJECT_TOUCH_EVENT
    msg[1] = action; // 0 down, 1 up, 2 move
    // pointer_id = -2 (generic finger)
    msg[2..10].copy_from_slice(&0xFFFF_FFFF_FFFF_FFFEu64.to_be_bytes());
    msg[10..14].copy_from_slice(&x.to_be_bytes());
    msg[14..18].copy_from_slice(&y.to_be_bytes());
    msg[18..20].copy_from_slice(&w.to_be_bytes());
    msg[20..22].copy_from_slice(&h.to_be_bytes());
    let p = if pressure >= 1.0 {
        0xFFFFu16
    } else if pressure <= 0.0 {
        0
    } else {
        (pressure * 65536.0) as u16
    };
    msg[22..24].copy_from_slice(&p.to_be_bytes());
    // action_button + buttons = 0 for finger
    let control = session.control.clone();
    drop(sessions);
    let mut guard = control.lock().unwrap();
    guard.write_all(&msg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scrcpy_key(state: tauri::State<'_, ScrcpyState>, id: u32, keycode: i32) -> Result<(), String> {
    let sessions = state.sessions.read().unwrap();
    let session = sessions.get(&id).ok_or("session not found")?;
    let control = session.control.clone();
    drop(sessions);
    let mut guard = control.lock().unwrap();
    for action in [0u8, 1u8] {
        let mut msg = [0u8; 14];
        msg[0] = 0x00; // INJECT_KEYCODE
        msg[1] = action;
        msg[2..6].copy_from_slice(&keycode.to_be_bytes());
        // repeat + metaState = 0
        guard.write_all(&msg).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Enumerate the device's *actually in-use* display ids (0 = main). Some
/// boards (e.g. Rockchip kitchen units) always register a second EXTERNAL/
/// HDMI logical display even when nothing is physically attached to that
/// port — that phantom display reports `mHasContent=false` in `dumpsys
/// display`, unlike a real dual-screen unit where the customer-facing
/// display actually has content drawn to it. Filter on that instead of just
/// presence of a display id, or every single-screen device with a reserved
/// HDMI-out would show up as "dual screen" with a permanently black mirror.
#[tauri::command]
pub fn scrcpy_list_displays(serial: String, adb_path: String) -> Result<Vec<u32>, String> {
    let out = adb(&adb_path, &serial)
        .args(["shell", "dumpsys", "display"])
        .output()
        .map_err(|e| format!("dumpsys display: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut ids: Vec<u32> = Vec::new();
    let mut current_id: Option<u32> = None;
    let mut current_has_content = false;
    let mut flush = |id: Option<u32>, has_content: bool, ids: &mut Vec<u32>| {
        if let Some(id) = id {
            if has_content && !ids.contains(&id) {
                ids.push(id);
            }
        }
    };
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("mDisplayId=") {
            flush(current_id, current_has_content, &mut ids);
            current_id = rest.trim().parse::<u32>().ok();
            current_has_content = false;
        } else if let Some(rest) = t.strip_prefix("mHasContent=") {
            current_has_content = rest.trim() == "true";
        }
    }
    flush(current_id, current_has_content, &mut ids);

    if ids.is_empty() {
        ids.push(0);
    }
    ids.sort_unstable();
    Ok(ids)
}

fn teardown(session: &Session) {
    session.stop.store(true, Ordering::Relaxed);
    if let Ok(c) = session.control.lock() {
        let _ = c.shutdown(std::net::Shutdown::Both);
    }
    // Kill the server immediately so the device's video encoder is released
    // before any new session on the same device starts (avoids encoder
    // contention that leaves a second mirror stuck "connecting").
    if let Ok(mut child) = session.shell.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = adb(&session.adb_path, &session.serial)
        .args([
            "forward",
            "--remove",
            &format!("tcp:{}", session.local_port),
        ])
        .output();
}

#[tauri::command]
pub fn scrcpy_stop(state: tauri::State<'_, ScrcpyState>, id: u32) -> Result<(), String> {
    let session = state.sessions.write().unwrap().remove(&id);
    if let Some(session) = session {
        teardown(&session);
    }
    Ok(())
}
