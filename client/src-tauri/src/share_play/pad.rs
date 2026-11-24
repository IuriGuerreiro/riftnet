use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const IO_TIMEOUT: Duration = Duration::from_secs(10);
const START_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REPLY: u64 = 64 * 1024;

pub const BUTTON_A: u16 = 0x1000;
pub const BUTTON_B: u16 = 0x2000;
const GUIDE: u16 = 0x0400;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PadState {
    pub buttons: u16,
    pub triggers: [u8; 2],
    pub sticks: [i16; 4],
}

impl PadState {
    pub fn encode(self) -> [u8; 20] {
        let mut out = [0; 20];
        out[..4].copy_from_slice(&u32::from(self.buttons & !GUIDE).to_le_bytes());
        out[4..6].copy_from_slice(&self.triggers);
        for (slot, axis) in out[6..14].chunks_exact_mut(2).zip(self.sticks) {
            slot.copy_from_slice(&axis.to_le_bytes());
        }
        out
    }
}

fn request(api: SocketAddr, line: &str, timeout: Duration) -> Result<serde_json::Value, String> {
    let err = |e: std::io::Error| format!("virtual controller service: {e}");
    let mut conn = TcpStream::connect_timeout(&api, timeout).map_err(err)?;
    conn.set_read_timeout(Some(timeout)).map_err(err)?;
    conn.set_write_timeout(Some(timeout)).map_err(err)?;
    conn.write_all(format!("{line}\0").as_bytes())
        .map_err(err)?;
    let mut reply = Vec::new();
    conn.take(MAX_REPLY).read_to_end(&mut reply).map_err(err)?;
    parse_reply(&reply)
}

fn parse_reply(reply: &[u8]) -> Result<serde_json::Value, String> {
    let text = std::str::from_utf8(reply).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(text.trim_matches(['\0', '\n', ' ']))
        .map_err(|e| format!("unexpected virtual controller reply: {e}"))?;
    if value["status"].as_u64().is_some_and(|s| s >= 400) {
        return Err(value["detail"]
            .as_str()
            .unwrap_or("virtual controller error")
            .to_owned());
    }
    Ok(value)
}

pub struct Pad {
    stream: TcpStream,
    api: SocketAddr,
    bus: u64,
    device: u64,
}

impl Pad {
    pub fn set(&mut self, state: PadState) -> Result<(), String> {
        self.stream
            .write_all(&state.encode())
            .map_err(|e| format!("virtual controller input: {e}"))
    }
}

impl Drop for Pad {
    fn drop(&mut self) {
        let _ = self.set(PadState::default());
        let remove = format!("bus/{}/remove {}", self.bus, self.device);
        if let Err(e) = request(self.api, &remove, Duration::from_secs(2)) {
            log::warn!("remove virtual controller: {e}");
        }
    }
}

pub struct Server {
    child: Child,
    api: SocketAddr,
    bus: u64,
}

fn free_ports() -> Result<(u16, u16), String> {
    let bind = || TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string());
    let port = |l: &TcpListener| l.local_addr().map(|a| a.port()).map_err(|e| e.to_string());
    let (a, b) = (bind()?, bind()?);
    Ok((port(&a)?, port(&b)?))
}

impl Server {
    pub fn start(
        exe: &Path,
        config: &Path,
        attach: bool,
        prepare: impl FnOnce(&mut Command),
    ) -> Result<Self, String> {
        let (usb, api) = free_ports()?;
        let mut cmd = Command::new(exe);
        for (name, _) in std::env::vars_os() {
            if name
                .to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("VIIPER_")
            {
                cmd.env_remove(name);
            }
        }
        // INVARIANT: both listeners stay on loopback; VIIPER binds every interface by default.
        cmd.arg("server")
            .arg(format!("--usb.addr=127.0.0.1:{usb}"))
            .arg(format!("--api.addr=127.0.0.1:{api}"))
            .arg(format!("--api.auto-attach-local-client={attach}"))
            .arg("--no-tray")
            .arg("--update-notify=none")
            .env("APPDATA", config)
            .env("XDG_CONFIG_HOME", config)
            .current_dir(config)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        prepare(&mut cmd);
        let child = cmd
            .spawn()
            .map_err(|e| format!("couldn't start VIIPER: {e}"))?;
        let mut server = Self {
            child,
            api: SocketAddr::from((Ipv4Addr::LOCALHOST, api)),
            bus: 0,
        };
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            if let Ok(Some(status)) = server.child.try_wait() {
                return Err(format!("VIIPER stopped ({status})"));
            }
            if request(server.api, "ping", Duration::from_secs(1))
                .is_ok_and(|v| v["server"] == "VIIPER")
            {
                break;
            }
            if Instant::now() > deadline {
                return Err("VIIPER didn't start".into());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        server.bus = request(server.api, "bus/create", IO_TIMEOUT)?["busId"]
            .as_u64()
            .ok_or("VIIPER returned no bus")?;
        Ok(server)
    }

    #[cfg(windows)]
    pub fn child(&self) -> &Child {
        &self.child
    }

    pub fn plug(&self) -> Result<Pad, String> {
        let bus = self.bus;
        let added = request(
            self.api,
            &format!(r#"bus/{bus}/add {{"type":"xbox360"}}"#),
            IO_TIMEOUT,
        )?;
        let device = added["devId"]
            .as_str()
            .and_then(|id| id.parse().ok())
            .ok_or("VIIPER returned no device")?;
        let err = |e: std::io::Error| format!("virtual controller stream: {e}");
        let mut stream = TcpStream::connect_timeout(&self.api, IO_TIMEOUT).map_err(err)?;
        stream.set_nodelay(true).map_err(err)?;
        stream
            .set_write_timeout(Some(Duration::from_millis(250)))
            .map_err(err)?;
        stream
            .write_all(format!("bus/{bus}/{device}\0").as_bytes())
            .map_err(err)?;
        let mut feedback = stream.try_clone().map_err(err)?;
        std::thread::Builder::new()
            .name("share-play-pad-feedback".into())
            .spawn(move || {
                let mut buf = [0; 64];
                while feedback.read(&mut buf).is_ok_and(|n| n > 0) {}
            })
            .map_err(err)?;
        Ok(Pad {
            stream,
            api: self.api,
            bus,
            device,
        })
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_the_wire_layout() {
        let bytes = PadState {
            buttons: BUTTON_A | BUTTON_B,
            triggers: [1, 255],
            sticks: [-32768, 32767, 1, -1],
        }
        .encode();
        assert_eq!(
            bytes,
            [
                0, 0x30, 0, 0, 1, 255, 0, 0x80, 0xff, 0x7f, 1, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0
            ]
        );
        assert_eq!(PadState::default().encode(), [0; 20]);
    }

    #[test]
    fn guide_button_never_reaches_the_host() {
        let state = PadState {
            buttons: u16::MAX,
            ..PadState::default()
        };
        assert_eq!(state.encode()[..4], [0xff, 0xfb, 0, 0]);
    }

    #[test]
    fn replies_surface_errors() {
        assert_eq!(parse_reply(b"{\"busId\":1}\n").unwrap()["busId"], 1);
        assert_eq!(
            parse_reply(br#"{"status":404,"title":"Not Found","detail":"gone"}"#),
            Err("gone".into())
        );
        assert!(parse_reply(b"").is_err());
    }

    #[test]
    #[ignore = "needs VIIPER_TEST_EXE"]
    fn drives_a_real_viiper_server() {
        let exe = std::env::var_os("VIIPER_TEST_EXE").unwrap();
        let dir = std::env::temp_dir().join(format!("adept-viiper-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let server = Server::start(Path::new(&exe), &dir, false, |_| {}).unwrap();
        let count = || {
            request(
                server.api,
                &format!("bus/{}/list", server.bus),
                Duration::from_secs(2),
            )
            .unwrap()["devices"]
                .as_array()
                .unwrap()
                .len()
        };
        let mut a = server.plug().unwrap();
        let mut b = server.plug().unwrap();
        assert_eq!(count(), 2);
        let pressed = PadState {
            buttons: BUTTON_A,
            ..PadState::default()
        };
        for _ in 0..500 {
            a.set(pressed).unwrap();
            b.set(PadState::default()).unwrap();
        }
        drop(a);
        assert_eq!(count(), 1);
        b.set(pressed).unwrap();
        drop(b);
        assert_eq!(count(), 0);
        let api = server.api;
        drop(server);
        assert!(request(api, "ping", Duration::from_secs(1)).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
