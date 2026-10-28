//! Scale simulator: speaks the XYD weighing-module protocol the Leniu scale
//! app reads, over the TCP end of an emulator serial port.
//!
//! XYD2 weigh frame: `01 01 00 <status> <w0 w1 w2 LE, grams> <sum> 0D 0A`.
//! XYD1 weigh frame: `01 01 00 <status> <w0 w1 LE, 10 g units> <sum>`.
//! The app parses each read() as one packet, so the runner writes exactly one
//! frame per tick.

use std::collections::{HashMap, VecDeque};
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;

use super::profile::ScaleProtocol;

const TICK: Duration = Duration::from_millis(50);
const SETTLE_MS: u64 = 600;
const MAX_ABS_GRAMS: i32 = 0x7F_FFFF;

const ST_NEGATIVE: u8 = 0x01;
const ST_STABLE: u8 = 0x02;
const ST_OVER: u8 = 0x04;
const ST_ZERO: u8 = 0x08;
const ST_TARE: u8 = 0x10;
const ST_UNDER: u8 = 0x40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmd {
    Tare,
    Zero,
    StartCalibrate(u8),
    Calibrate,
    EndCalibrate,
    Param(u8),
}

impl Cmd {
    fn label(self) -> &'static str {
        match self {
            Cmd::Tare => "去皮",
            Cmd::Zero => "置零",
            Cmd::StartCalibrate(_) => "开始标定",
            Cmd::Calibrate => "标定",
            Cmd::EndCalibrate => "结束标定",
            Cmd::Param(_) => "设置参数",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    pub protocol: ScaleProtocol,
    pub gross_g: i32,
    pub zero_g: i32,
    pub tare_g: i32,
    pub shaking: bool,
    pub over: bool,
    pub changed_at_ms: u64,
}

impl Model {
    pub fn new(protocol: ScaleProtocol) -> Self {
        Self {
            protocol,
            gross_g: 0,
            zero_g: 0,
            tare_g: 0,
            shaking: false,
            over: false,
            changed_at_ms: 0,
        }
    }

    pub fn net(&self) -> i32 {
        self.gross_g - self.zero_g - self.tare_g
    }

    pub fn stable(&self, now_ms: u64) -> bool {
        !self.shaking && now_ms.saturating_sub(self.changed_at_ms) >= SETTLE_MS
    }

    pub fn set_load(&mut self, gross_g: i32, shaking: bool, over: bool, now_ms: u64) {
        let gross_g = gross_g.clamp(-MAX_ABS_GRAMS, MAX_ABS_GRAMS);
        if gross_g != self.gross_g {
            self.changed_at_ms = now_ms;
        }
        self.gross_g = gross_g;
        self.shaking = shaking;
        self.over = over;
    }

    pub fn status(&self, now_ms: u64) -> u8 {
        let net = self.net();
        let stable = self.stable(now_ms);
        let mut s = 0;
        if net < 0 {
            s |= ST_NEGATIVE;
        }
        if stable {
            s |= ST_STABLE;
        }
        if self.over {
            s |= ST_OVER;
        }
        if net == 0 && stable {
            s |= ST_ZERO;
        }
        if self.tare_g != 0 {
            s |= ST_TARE;
        }
        if self.gross_g - self.zero_g < 0 {
            s |= ST_UNDER;
        }
        s
    }

    pub fn weigh_frame(&self, now_ms: u64) -> Vec<u8> {
        let status = self.status(now_ms);
        let abs = self.net().unsigned_abs().min(MAX_ABS_GRAMS as u32);
        let mut f = vec![0x01, 0x01, 0x00, status];
        match self.protocol {
            ScaleProtocol::Xyd2 => {
                f.extend_from_slice(&[abs as u8, (abs >> 8) as u8, (abs >> 16) as u8]);
            }
            ScaleProtocol::Xyd1 => {
                let units = (abs / 10).min(0xFFFF);
                f.extend_from_slice(&[units as u8, (units >> 8) as u8]);
            }
        }
        f.push(sum(&f));
        self.terminate(f)
    }

    /// Applies a command from the app and returns the module's reply.
    pub fn apply(&mut self, cmd: Cmd, now_ms: u64) -> Vec<u8> {
        let stable = self.stable(now_ms);
        let (code, ok, reply_status) = match cmd {
            Cmd::Tare => {
                if stable {
                    self.tare_g = self.gross_g - self.zero_g;
                }
                (0x04, stable, None)
            }
            Cmd::Zero => {
                if stable {
                    self.zero_g = self.gross_g;
                    self.tare_g = 0;
                }
                (0x02, stable, None)
            }
            Cmd::StartCalibrate(c) => (c, true, None),
            Cmd::Calibrate => (0x03, true, None),
            Cmd::EndCalibrate => (0x07, true, None),
            // The app only checks `pkg[3] == 0` on parameter acks.
            Cmd::Param(c) => (c, true, Some([0x00, 0x00])),
        };
        let mut f = vec![0x01, code];
        match reply_status {
            Some(tail) => f.extend_from_slice(&tail),
            None => {
                f.push(if ok { 0x00 } else { 0x01 });
                f.push(sum(&f));
            }
        }
        self.terminate(f)
    }

    fn terminate(&self, mut f: Vec<u8>) -> Vec<u8> {
        if self.protocol == ScaleProtocol::Xyd2 {
            f.extend_from_slice(&[0x0D, 0x0A]);
        }
        f
    }
}

fn sum(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0u8, |a, b| a.wrapping_add(*b))
}

/// Pulls complete commands off the front of `buf`; garbage is skipped a byte
/// at a time so one bad byte can't wedge the stream.
pub fn take_commands(buf: &mut Vec<u8>, protocol: ScaleProtocol) -> Vec<Cmd> {
    let mut cmds = Vec::new();
    let mut i = 0;
    while i < buf.len() {
        if buf[i] != 0x01 {
            i += 1;
            continue;
        }
        let Some(&code) = buf.get(i + 1) else { break };
        let len = match code {
            0x02 | 0x04 | 0x06 | 0x07 | 0x08 => 3,
            0x03 if protocol == ScaleProtocol::Xyd2 => 6,
            0x03 => 5,
            0x0A..=0x0C => 4,
            _ => {
                i += 1;
                continue;
            }
        };
        if buf.len() < i + len {
            break;
        }
        let frame = &buf[i..i + len];
        if sum(&frame[..len - 1]) != frame[len - 1] {
            i += 1;
            continue;
        }
        cmds.push(match code {
            0x04 => Cmd::Tare,
            0x02 => Cmd::Zero,
            0x06 | 0x08 => Cmd::StartCalibrate(code),
            0x07 => Cmd::EndCalibrate,
            0x03 => Cmd::Calibrate,
            c => Cmd::Param(c),
        });
        i += len;
    }
    buf.drain(..i);
    cmds
}

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScaleSnapshot {
    pub connected: bool,
    pub net_g: i32,
    pub tare_g: i32,
    pub zero_g: i32,
    pub stable: bool,
    pub last_command: Option<String>,
}

struct Sim {
    host_port: u16,
    model: Arc<Mutex<Model>>,
    started: Instant,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct ScaleSimState {
    next_id: AtomicU32,
    sims: Mutex<HashMap<u32, Sim>>,
}

impl ScaleSimState {
    pub fn kill_all(&self) {
        for (_, s) in self.sims.lock().unwrap().drain() {
            s.stop.store(true, Ordering::Relaxed);
        }
    }
}

fn run(
    host_port: u16,
    model: Arc<Mutex<Model>>,
    started: Instant,
    stop: Arc<AtomicBool>,
    on_event: Channel<ScaleSnapshot>,
) {
    let addr = SocketAddr::from(([127, 0, 0, 1], host_port));
    let now_ms = || started.elapsed().as_millis() as u64;
    let mut last: Option<ScaleSnapshot> = None;
    let mut last_command: Option<String> = None;
    let mut emit = |connected: bool, last_command: &Option<String>| {
        let snap = {
            let m = model.lock().unwrap();
            ScaleSnapshot {
                connected,
                net_g: m.net(),
                tare_g: m.tare_g,
                zero_g: m.zero_g,
                stable: m.stable(now_ms()),
                last_command: last_command.clone(),
            }
        };
        if last.as_ref() != Some(&snap) {
            let _ = on_event.send(snap.clone());
            last = Some(snap);
        }
    };

    while !stop.load(Ordering::Relaxed) {
        let Ok(mut sock) = TcpStream::connect_timeout(&addr, Duration::from_secs(1)) else {
            emit(false, &last_command);
            std::thread::sleep(Duration::from_secs(1));
            continue;
        };
        let _ = sock.set_nodelay(true);
        let _ = sock.set_nonblocking(true);
        let mut inbox = Vec::new();
        let mut replies: VecDeque<Vec<u8>> = VecDeque::new();
        let mut buf = [0u8; 256];
        'conn: while !stop.load(Ordering::Relaxed) {
            loop {
                match sock.read(&mut buf) {
                    Ok(0) => break 'conn,
                    Ok(n) => inbox.extend_from_slice(&buf[..n]),
                    Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                    Err(_) => break 'conn,
                }
            }
            if inbox.len() > 4096 {
                inbox.clear();
            }
            let protocol = model.lock().unwrap().protocol;
            for cmd in take_commands(&mut inbox, protocol) {
                let reply = model.lock().unwrap().apply(cmd, now_ms());
                replies.push_back(reply);
                last_command = Some(cmd.label().to_string());
            }
            let frame = replies
                .pop_front()
                .unwrap_or_else(|| model.lock().unwrap().weigh_frame(now_ms()));
            if write_all_nb(&mut sock, &frame).is_err() {
                break;
            }
            emit(true, &last_command);
            std::thread::sleep(TICK);
        }
        emit(false, &last_command);
    }
}

fn write_all_nb(sock: &mut TcpStream, mut data: &[u8]) -> std::io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !data.is_empty() {
        match sock.write(data) {
            Ok(0) => return Err(ErrorKind::WriteZero.into()),
            Ok(n) => data = &data[n..],
            Err(e) if e.kind() == ErrorKind::WouldBlock && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn scale_sim_start(
    state: tauri::State<'_, ScaleSimState>,
    host_port: u16,
    protocol: ScaleProtocol,
    on_event: Channel<ScaleSnapshot>,
) -> Result<u32, String> {
    if host_port < 1024 {
        return Err(format!("端口不对: {host_port}"));
    }
    let mut sims = state.sims.lock().unwrap();
    // One simulator per port: a second one would fight over the bridge.
    sims.retain(|_, s| {
        let same = s.host_port == host_port;
        if same {
            s.stop.store(true, Ordering::Relaxed);
        }
        !same
    });
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let model = Arc::new(Mutex::new(Model::new(protocol)));
    let stop = Arc::new(AtomicBool::new(false));
    let started = Instant::now();
    {
        let (model, stop) = (model.clone(), stop.clone());
        std::thread::Builder::new()
            .name(format!("scale-sim-{host_port}"))
            .spawn(move || run(host_port, model, started, stop, on_event))
            .map_err(|e| format!("启动电子秤模拟失败: {e}"))?;
    }
    sims.insert(
        id,
        Sim {
            host_port,
            model,
            started,
            stop,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn scale_sim_update(
    state: tauri::State<'_, ScaleSimState>,
    id: u32,
    gross_g: i32,
    shaking: bool,
    over: bool,
) -> Result<(), String> {
    let sims = state.sims.lock().unwrap();
    let sim = sims.get(&id).ok_or("电子秤模拟已停止")?;
    let now = sim.started.elapsed().as_millis() as u64;
    sim.model
        .lock()
        .unwrap()
        .set_load(gross_g, shaking, over, now);
    Ok(())
}

#[tauri::command]
pub fn scale_sim_stop(state: tauri::State<'_, ScaleSimState>, id: u32) {
    if let Some(s) = state.sims.lock().unwrap().remove(&id) {
        s.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settled(protocol: ScaleProtocol, gross: i32) -> Model {
        let mut m = Model::new(protocol);
        m.set_load(gross, false, false, 0);
        m
    }

    #[test]
    fn empty_xyd2_frame_matches_real_device() {
        // Captured from a real CRKC-3588A scale at rest.
        let m = settled(ScaleProtocol::Xyd2, 0);
        assert_eq!(
            m.weigh_frame(10_000),
            vec![0x01, 0x01, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x0C, 0x0D, 0x0A]
        );
    }

    #[test]
    fn xyd2_weight_is_little_endian_grams() {
        let m = settled(ScaleProtocol::Xyd2, 0x012345);
        let f = m.weigh_frame(10_000);
        assert_eq!(&f[4..7], &[0x45, 0x23, 0x01]);
        assert_eq!(f[3], ST_STABLE);
        assert_eq!(f[7], sum(&f[..7]));
        assert_eq!(f.len(), 10);
    }

    #[test]
    fn xyd1_weight_is_10g_units_without_terminator() {
        let m = settled(ScaleProtocol::Xyd1, 1850);
        // The example frame in the app source: 01 01 00 02 B9 00 BD.
        assert_eq!(
            m.weigh_frame(10_000),
            vec![0x01, 0x01, 0x00, 0x02, 0xB9, 0x00, 0xBD]
        );
    }

    #[test]
    fn negative_and_unstable_status() {
        let mut m = settled(ScaleProtocol::Xyd2, 500);
        m.set_load(-200, false, false, 1000);
        let st = m.status(1100);
        assert_eq!(st & ST_NEGATIVE, ST_NEGATIVE);
        assert_eq!(st & ST_STABLE, 0);
        assert_eq!(st & ST_UNDER, ST_UNDER);
        assert!(m.stable(1000 + SETTLE_MS));
        m.set_load(-200, true, true, 5000);
        assert!(!m.stable(99_999));
        assert_eq!(m.status(99_999) & ST_OVER, ST_OVER);
    }

    #[test]
    fn tare_and_zero() {
        let mut m = settled(ScaleProtocol::Xyd2, 300);
        assert_eq!(
            m.apply(Cmd::Tare, 10_000),
            vec![0x01, 0x04, 0x00, 0x05, 0x0D, 0x0A]
        );
        assert_eq!(m.net(), 0);
        assert_eq!(m.status(10_000) & ST_TARE, ST_TARE);
        m.set_load(1300, false, false, 10_000);
        assert_eq!(m.net(), 1000);
        // Unstable: refused, and the app sees the failure code.
        assert_eq!(
            m.apply(Cmd::Zero, 10_100),
            vec![0x01, 0x02, 0x01, 0x04, 0x0D, 0x0A]
        );
        assert_eq!(
            m.apply(Cmd::Zero, 20_000),
            vec![0x01, 0x02, 0x00, 0x03, 0x0D, 0x0A]
        );
        assert_eq!((m.net(), m.tare_g), (0, 0));
    }

    #[test]
    fn xyd1_replies_have_no_terminator() {
        let mut m = settled(ScaleProtocol::Xyd1, 0);
        assert_eq!(m.apply(Cmd::Tare, 10_000), vec![0x01, 0x04, 0x00, 0x05]);
    }

    #[test]
    fn param_ack_passes_app_check() {
        let mut m = settled(ScaleProtocol::Xyd2, 0);
        let r = m.apply(Cmd::Param(0x0C), 0);
        assert!(r.len() > 4 && r[1] == 0x0C && r[3] == 0x00);
    }

    #[test]
    fn take_commands_handles_split_and_garbage() {
        let mut buf = vec![0xFF, 0x01, 0x04, 0x05, 0x01, 0x02];
        assert_eq!(
            take_commands(&mut buf, ScaleProtocol::Xyd2),
            vec![Cmd::Tare]
        );
        assert_eq!(buf, vec![0x01, 0x02]);
        buf.push(0x03);
        assert_eq!(
            take_commands(&mut buf, ScaleProtocol::Xyd2),
            vec![Cmd::Zero]
        );
        assert!(buf.is_empty());

        // Calibrate with a 3-byte weight (xyd2) vs 2-byte (xyd1).
        let mut cal2 = vec![0x01, 0x03, 0x10, 0x27, 0x00];
        cal2.push(sum(&cal2));
        assert_eq!(
            take_commands(&mut cal2.clone(), ScaleProtocol::Xyd2),
            vec![Cmd::Calibrate]
        );
        let mut cal1 = vec![0x01, 0x03, 0x10, 0x27];
        cal1.push(sum(&cal1));
        assert_eq!(
            take_commands(&mut cal1, ScaleProtocol::Xyd1),
            vec![Cmd::Calibrate]
        );

        let mut bad = vec![0x01, 0x04, 0x99, 0x01, 0x07, 0x08];
        assert_eq!(
            take_commands(&mut bad, ScaleProtocol::Xyd2),
            vec![Cmd::EndCalibrate]
        );
    }
}
