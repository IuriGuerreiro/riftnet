//! Share Play host: a viewer drives this PC's keyboard and mouse.
//!
//! The webview receives input over a WebRTC data channel and forwards each
//! event here. One thread owns all OS input. Control messages (approve, arm,
//! revoke) always run before queued input, the input queue is bounded, and a
//! lease ends control if the viewer goes quiet. Windows and X11 only (#56).

mod input;
mod keymap;
mod mapping;
#[cfg(any(windows, target_os = "linux"))]
mod os;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{
    self, Receiver, RecvTimeoutError, Sender, SyncSender, TryRecvError, TrySendError,
};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub use input::InputEvent;
use input::{ArmError, Backend, Controller, Tag};
use mapping::Rect;

/// Local panic button: ends control even while a game has focus.
pub const REVOKE_HOTKEY: &str = "CommandOrControl+Shift+F12";
/// Emitted to the webview whenever control ends on this side (hotkey,
/// lease expired, overload), so it tells the server.
pub const REVOKE_EVENT: &str = "share-play://revoked";
/// ~2 s of input at the SFU's rate limit. Full = something is wrong: revoke.
const INPUT_QUEUE: usize = 256;
const ACTIVE_TICK: Duration = Duration::from_millis(8);
const IDLE_TICK: Duration = Duration::from_millis(50);
type QueuedInput = (Tag, InputEvent, Instant);

enum Ctrl {
    Approve {
        controller_id: u64,
        request_id: u64,
        target: Rect,
    },
    Arm {
        grant_id: u64,
        controller_id: u64,
        request_id: u64,
        reply: Sender<Result<(), ArmError>>,
    },
    Revoke,
}

pub struct SharePlay {
    ctrl: Sender<Ctrl>,
    input: SyncSender<QueuedInput>,
    /// Set the moment a revoke is requested, before it is queued, so input
    /// already in the queue is never applied after it.
    revoking: Arc<AtomicBool>,
}

/// Linux: X11 only. Under Wayland (even with XWayland) injected X11 input
/// only reaches X11 apps, so we say no.
pub fn linux_supported(session_type: Option<&str>, wayland: bool, x11: bool) -> bool {
    match session_type {
        Some("x11") => x11,
        Some("wayland") => false,
        _ => x11 && !wayland,
    }
}

pub fn supported() -> bool {
    if cfg!(windows) {
        return true;
    }
    if cfg!(target_os = "linux") {
        let session = std::env::var("XDG_SESSION_TYPE").ok();
        return linux_supported(
            session.as_deref(),
            std::env::var_os("WAYLAND_DISPLAY").is_some(),
            std::env::var_os("DISPLAY").is_some(),
        );
    }
    false
}

/// Fallback backend: a platform we can't inject on. Drops everything.
struct Nothing;
impl Backend for Nothing {
    fn key(&mut self, _: keymap::Key, _: bool) -> bool {
        false
    }
    fn button(&mut self, _: u8, _: bool) -> bool {
        true
    }
    fn move_to(&mut self, _: i32, _: i32) {}
    fn scroll(&mut self, _: i32, _: i32) {}
    fn host_mouse_activity(&mut self) -> Result<bool, String> {
        Err("host mouse monitoring is unavailable".into())
    }
    fn location(&self) -> Option<(i32, i32)> {
        None
    }
}

struct Worker<B: Backend, F: Fn(&'static str)> {
    ctl: Controller,
    os: B,
    revoking: Arc<AtomicBool>,
    on_revoked: F,
}

impl<B: Backend, F: Fn(&'static str)> Worker<B, F> {
    fn handle(&mut self, msg: Ctrl) {
        match msg {
            Ctrl::Approve {
                controller_id,
                request_id,
                target,
            } => self
                .ctl
                .approve(controller_id, request_id, target, Instant::now()),
            Ctrl::Arm {
                grant_id,
                controller_id,
                request_id,
                reply,
            } => {
                let r = if self.check_host_mouse().is_ok() {
                    self.ctl.arm(
                        grant_id,
                        controller_id,
                        request_id,
                        Instant::now(),
                        &mut self.os,
                    )
                } else {
                    self.ctl.revoke(&mut self.os);
                    Err(ArmError::MouseMonitoringUnavailable)
                };
                let _ = reply.send(r);
            }
            Ctrl::Revoke => {
                self.revoking.store(false, Ordering::SeqCst);
                self.ctl.revoke(&mut self.os);
            }
        }
    }

    /// Run every queued control message. Returns false when the app is gone.
    fn drain(&mut self, ctrl: &Receiver<Ctrl>) -> bool {
        loop {
            match ctrl.try_recv() {
                Ok(m) => self.handle(m),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return false,
            }
        }
        // Revoke requested but its message isn't queued yet: act now anyway.
        if self.revoking.swap(false, Ordering::SeqCst) {
            self.ctl.revoke(&mut self.os);
        }
        true
    }

    fn poll_host_mouse(&mut self) -> Result<(), &'static str> {
        let active = self.os.host_mouse_activity().map_err(|err| {
            if self.ctl.is_armed() {
                log::warn!("share play mouse monitor: {err}");
            }
            "host mouse monitoring failed"
        })?;
        if active && !self.ctl.host_mouse_activity(Instant::now(), &mut self.os) {
            return Err("native input failed");
        }
        Ok(())
    }

    fn check_host_mouse(&mut self) -> Result<(), &'static str> {
        let result = self.poll_host_mouse();
        if let Err(why) = result
            && self.ctl.is_armed()
        {
            self.ctl.revoke(&mut self.os);
            (self.on_revoked)(why);
        }
        result
    }

    fn run(mut self, ctrl: Receiver<Ctrl>, input: Receiver<QueuedInput>) {
        loop {
            if !self.drain(&ctrl) {
                break;
            }
            let _ = self.check_host_mouse();
            if self.ctl.tick(Instant::now(), &mut self.os) {
                (self.on_revoked)("lease");
            }
            let tick = if self.ctl.is_armed() {
                ACTIVE_TICK
            } else {
                IDLE_TICK
            };
            match input.recv_timeout(tick) {
                Ok((from, event, received_at)) => {
                    // Control goes first: a revoke queued meanwhile wins.
                    if !self.drain(&ctrl) {
                        break;
                    }
                    let _ = self.check_host_mouse();
                    if let Err(why) = self.ctl.apply(from, event, received_at, &mut self.os) {
                        if why != input::Rejected::HostMousePriority {
                            log::debug!("share play input dropped: {why:?}");
                        }
                        if why == input::Rejected::NativeFailure {
                            self.ctl.revoke(&mut self.os);
                            (self.on_revoked)("native input failed");
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        // App shutting down: never leave keys stuck.
        self.ctl.revoke(&mut self.os);
    }
}

impl SharePlay {
    pub fn start<R: Runtime>(app: AppHandle<R>) -> Self {
        let (ctrl, ctrl_rx) = mpsc::channel();
        let (input, input_rx) = mpsc::sync_channel(INPUT_QUEUE);
        let revoking = Arc::new(AtomicBool::new(false));
        let flag = revoking.clone();
        let on_revoked = move |why: &'static str| {
            log::info!("share play revoked locally: {why}");
            let _ = app.emit(REVOKE_EVENT, why);
        };
        let spawned = std::thread::Builder::new()
            .name("share-play-input".into())
            .spawn(move || {
                #[cfg(any(windows, target_os = "linux"))]
                if supported() {
                    match os::Enigo::new() {
                        Ok(os) => {
                            let w = Worker {
                                ctl: Controller::default(),
                                os,
                                revoking: flag,
                                on_revoked,
                            };
                            return w.run(ctrl_rx, input_rx);
                        }
                        Err(e) => log::warn!("share play: no input backend: {e}"),
                    }
                }
                let w = Worker {
                    ctl: Controller::default(),
                    os: Nothing,
                    revoking: flag,
                    on_revoked,
                };
                w.run(ctrl_rx, input_rx)
            });
        if let Err(e) = spawned {
            log::warn!("share play: input thread failed: {e}");
        }
        Self {
            ctrl,
            input,
            revoking,
        }
    }

    pub fn revoke(&self) {
        self.revoking.store(true, Ordering::SeqCst);
        let _ = self.ctrl.send(Ctrl::Revoke);
    }

    /// Queue one event. A full queue means the host can't keep up: revoke.
    fn push(&self, from: Tag, event: InputEvent) -> Result<(), &'static str> {
        match self.input.try_send((from, event, Instant::now())) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.revoke();
                Err("overload")
            }
            Err(TrySendError::Disconnected(_)) => Err("input thread stopped"),
        }
    }
}

#[derive(serde::Serialize)]
pub struct MonitorInfo {
    name: String,
    rect: Rect,
}

#[derive(serde::Serialize)]
pub struct Monitors {
    monitors: Vec<MonitorInfo>,
    /// Index of the only monitor with the captured size, if exactly one.
    suggested: Option<usize>,
}

fn monitors<R: Runtime>(app: &AppHandle<R>) -> Vec<MonitorInfo> {
    let Some(win) = app.webview_windows().into_values().next() else {
        return Vec::new();
    };
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            name: m
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Screen {}", i + 1)),
            rect: Rect {
                x: m.position().x,
                y: m.position().y,
                width: m.size().width,
                height: m.size().height,
            },
        })
        .collect()
}

fn parse_id(id: &str) -> Result<u64, String> {
    id.parse().map_err(|_| format!("bad id: {id}"))
}

fn hotkey<R: Runtime>(app: &AppHandle<R>, on: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    if on {
        if gs.is_registered(REVOKE_HOTKEY) {
            return Ok(());
        }
        gs.on_shortcut(REVOKE_HOTKEY, |app, _, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                app.state::<SharePlay>().revoke();
                let _ = app.emit(REVOKE_EVENT, "hotkey");
            }
        })
        .map_err(|e| format!("couldn't register {REVOKE_HOTKEY}: {e}"))
    } else {
        if gs.is_registered(REVOKE_HOTKEY) {
            let _ = gs.unregister(REVOKE_HOTKEY);
        }
        Ok(())
    }
}

#[tauri::command]
pub fn share_play_supported() -> bool {
    supported()
}

/// Monitors to pick from before approving. `width`/`height` = capture size.
#[tauri::command]
pub fn share_play_monitors<R: Runtime>(app: AppHandle<R>, width: u32, height: u32) -> Monitors {
    let monitors = monitors(&app);
    let rects: Vec<Rect> = monitors.iter().map(|m| m.rect).collect();
    Monitors {
        suggested: mapping::unique_match(&rects, width, height),
        monitors,
    }
}

/// The host clicked Approve on this machine, for this request and monitor.
/// Refused unless the revoke hotkey is registered.
#[tauri::command]
pub fn share_play_approve<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharePlay>,
    controller_id: String,
    request_id: String,
    monitor: Rect,
    warning_acknowledged: bool,
) -> Result<(), String> {
    if !warning_acknowledged {
        return Err("Read and acknowledge the Share Play warning first".into());
    }
    if !supported() {
        return Err("remote control isn't supported on this system".into());
    }
    if !monitors(&app).iter().any(|m| m.rect == monitor) {
        return Err("that monitor is gone".into());
    }
    hotkey(&app, true)?;
    let _ = state.ctrl.send(Ctrl::Approve {
        controller_id: parse_id(&controller_id)?,
        request_id: parse_id(&request_id)?,
        target: monitor,
    });
    Ok(())
}

/// The server confirmed grant `grant_id` for request `request_id`. Arms
/// once, only after a local approval of that same request.
#[tauri::command]
pub async fn share_play_arm<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharePlay>,
    grant_id: String,
    controller_id: String,
    request_id: String,
) -> Result<(), String> {
    if let Err(e) = hotkey(&app, true) {
        state.revoke();
        return Err(e);
    }
    let (reply, rx) = mpsc::channel();
    let _ = state.ctrl.send(Ctrl::Arm {
        grant_id: parse_id(&grant_id)?,
        controller_id: parse_id(&controller_id)?,
        request_id: parse_id(&request_id)?,
        reply,
    });
    match tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(1)))
        .await
        .map_err(|e| e.to_string())?
    {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("not armed: {e:?}")),
        Err(_) => {
            state.revoke();
            Err("input thread didn't answer".into())
        }
    }
}

#[tauri::command]
pub fn share_play_revoke<R: Runtime>(app: AppHandle<R>, state: State<'_, SharePlay>) {
    state.revoke();
    let _ = hotkey(&app, false);
}

/// One event from the data channel. Sender and grant come from the SFU tag,
/// not from the viewer, and are checked against the grant on the input
/// thread when the event is applied. `lossy` = the unordered move channel.
#[tauri::command]
pub async fn share_play_input<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharePlay>,
    sender: String,
    grant_id: String,
    lossy: bool,
    event: InputEvent,
) -> Result<(), String> {
    let from = Tag {
        sender: parse_id(&sender)?,
        grant_id: parse_id(&grant_id)?,
        lossy,
    };
    state.push(from, event).map_err(|why| {
        let _ = app.emit(REVOKE_EVENT, why);
        why.to_string()
    })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    #[test]
    fn linux_gate() {
        assert!(linux_supported(Some("x11"), false, true));
        assert!(
            !linux_supported(Some("wayland"), true, true),
            "XWayland isn't enough"
        );
        assert!(!linux_supported(Some("wayland"), false, false));
        assert!(linux_supported(None, false, true));
        assert!(!linux_supported(None, true, true));
        assert!(!linux_supported(Some("tty"), false, false));
    }

    #[derive(Clone, Default)]
    struct Rec(Rc<RefCell<Vec<String>>>);
    impl Backend for Rec {
        fn key(&mut self, k: keymap::Key, down: bool) -> bool {
            self.0.borrow_mut().push(format!("key {k:?} {down}"));
            true
        }
        fn button(&mut self, _: u8, _: bool) -> bool {
            true
        }
        fn move_to(&mut self, _: i32, _: i32) {}
        fn scroll(&mut self, _: i32, _: i32) {}
        fn location(&self) -> Option<(i32, i32)> {
            None
        }
    }

    const SCREEN: Rect = Rect {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
    };

    type TestWorker = Worker<Rec, fn(&'static str)>;

    fn armed_worker() -> (TestWorker, Rec, Receiver<Ctrl>, Sender<Ctrl>) {
        let rec = Rec::default();
        let (tx, rx) = mpsc::channel();
        let mut w = Worker {
            ctl: Controller::default(),
            os: rec.clone(),
            revoking: Arc::new(AtomicBool::new(false)),
            on_revoked: (|_| {}) as fn(&'static str),
        };
        w.handle(Ctrl::Approve {
            controller_id: 7,
            request_id: 3,
            target: SCREEN,
        });
        let (reply, ok) = mpsc::channel();
        w.handle(Ctrl::Arm {
            grant_id: 1,
            controller_id: 7,
            request_id: 3,
            reply,
        });
        ok.recv().unwrap().unwrap();
        (w, rec, rx, tx)
    }

    const FROM: Tag = Tag {
        sender: 7,
        grant_id: 1,
        lossy: false,
    };

    #[test]
    fn revoke_beats_queued_input() {
        let (mut w, rec, ctrl_rx, ctrl_tx) = armed_worker();
        let key = |down| InputEvent::Key {
            code: "KeyW".into(),
            down,
        };
        w.ctl
            .apply(FROM, key(true), Instant::now(), &mut w.os)
            .unwrap();
        // Revoke flag raised (hotkey) while more input is already queued.
        w.revoking.store(true, Ordering::SeqCst);
        ctrl_tx.send(Ctrl::Revoke).unwrap();
        assert!(w.drain(&ctrl_rx));
        assert!(w.ctl.armed().is_none());
        assert_eq!(
            w.ctl.apply(FROM, key(true), Instant::now(), &mut w.os),
            Err(input::Rejected::NotGranted)
        );
        assert_eq!(
            rec.0.borrow().as_slice(),
            ["key Char('w') true", "key Char('w') false"]
        );
    }

    #[test]
    fn revoke_flag_alone_revokes_before_message_arrives() {
        let (mut w, _, ctrl_rx, _tx) = armed_worker();
        w.revoking.store(true, Ordering::SeqCst);
        assert!(w.drain(&ctrl_rx));
        assert!(w.ctl.armed().is_none());
    }

    #[test]
    fn revoke_then_new_arm_keeps_the_new_grant() {
        let (mut w, _, ctrl_rx, ctrl_tx) = armed_worker();
        w.revoking.store(true, Ordering::SeqCst);
        ctrl_tx.send(Ctrl::Revoke).unwrap();
        ctrl_tx
            .send(Ctrl::Approve {
                controller_id: 7,
                request_id: 3,
                target: SCREEN,
            })
            .unwrap();
        let (reply, ok) = mpsc::channel();
        ctrl_tx
            .send(Ctrl::Arm {
                grant_id: 2,
                controller_id: 7,
                request_id: 3,
                reply,
            })
            .unwrap();
        assert!(w.drain(&ctrl_rx));
        ok.recv().unwrap().unwrap();
        assert_eq!(w.ctl.armed().map(|g| g.grant_id), Some(2));
    }

    #[test]
    fn full_queue_revokes() {
        let (ctrl, ctrl_rx) = mpsc::channel();
        let (input, _input_rx) = mpsc::sync_channel(1);
        let sp = SharePlay {
            ctrl,
            input,
            revoking: Arc::new(AtomicBool::new(false)),
        };
        assert!(sp.push(FROM, InputEvent::Ping).is_ok());
        assert_eq!(sp.push(FROM, InputEvent::Ping), Err("overload"));
        assert!(sp.revoking.load(Ordering::SeqCst));
        assert!(matches!(ctrl_rx.try_recv(), Ok(Ctrl::Revoke)));
    }
}
