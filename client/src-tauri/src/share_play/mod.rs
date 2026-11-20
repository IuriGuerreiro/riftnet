//! Share Play host: a viewer drives this PC's keyboard and mouse.
//!
//! The webview receives input over a WebRTC data channel and forwards each
//! event here. All OS input goes through one thread that owns the grant,
//! so nothing is applied without it, and revoke always releases held keys.
//! Windows and X11 only (Wayland: issue #56).

mod input;
mod keymap;
mod mapping;
#[cfg(any(windows, target_os = "linux"))]
mod os;

use std::sync::Mutex;
use std::sync::mpsc::{self, Sender};

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub use input::InputEvent;
use input::{Backend, Controller, Grant};
use mapping::Rect;

/// Local panic button: ends control even while a game has focus.
pub const REVOKE_HOTKEY: &str = "CommandOrControl+Shift+F12";
/// Emitted to the webview when the hotkey fires, so it tells the server.
pub const REVOKE_EVENT: &str = "share-play://revoked";

enum Msg {
    Grant(Grant),
    Revoke,
    Input(u64, InputEvent),
}

pub struct SharePlay {
    tx: Mutex<Option<Sender<Msg>>>,
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
    fn key(&mut self, _: &str, _: bool) {}
    fn button(&mut self, _: u8, _: bool) {}
    fn move_to(&mut self, _: i32, _: i32) {}
    fn scroll(&mut self, _: i32, _: i32) {}
}

fn run(rx: mpsc::Receiver<Msg>, mut os: impl Backend) {
    let mut ctl = Controller::default();
    for msg in rx {
        match msg {
            Msg::Grant(g) => ctl.set_grant(g, &mut os),
            Msg::Revoke => ctl.revoke(&mut os),
            Msg::Input(sender, ev) => {
                if let Err(why) = ctl.apply(sender, ev, &mut os) {
                    log::debug!("share play input dropped: {why:?}");
                }
            }
        }
    }
    // App shutting down: never leave keys stuck.
    ctl.revoke(&mut os);
}

impl SharePlay {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("share-play-input".into())
            .spawn(move || {
                #[cfg(any(windows, target_os = "linux"))]
                if supported() {
                    match os::Enigo::new() {
                        Ok(os) => return run(rx, os),
                        Err(e) => log::warn!("share play: no input backend: {e}"),
                    }
                }
                run(rx, Nothing)
            });
        Self {
            tx: Mutex::new(spawned.ok().map(|_| tx)),
        }
    }

    fn send(&self, msg: Msg) {
        if let Some(tx) = self.tx.lock().unwrap().as_ref() {
            let _ = tx.send(msg);
        }
    }

    pub fn revoke(&self) {
        self.send(Msg::Revoke);
    }
}

fn monitors<R: Runtime>(app: &AppHandle<R>) -> Vec<Rect> {
    let Some(win) = app.webview_windows().into_values().next() else {
        return Vec::new();
    };
    let mut list = win.available_monitors().unwrap_or_default();
    // Primary first, so ties go to it.
    if let Ok(Some(primary)) = win.primary_monitor()
        && let Some(i) = list.iter().position(|m| m.name() == primary.name())
    {
        list.swap(0, i);
    }
    list.iter()
        .map(|m| Rect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect()
}

fn parse_id(id: &str) -> Result<u64, String> {
    id.parse().map_err(|_| format!("bad user id: {id}"))
}

#[tauri::command]
pub fn share_play_supported() -> bool {
    supported()
}

/// Host approved `controller_id`. `width`/`height` = the captured video size,
/// used to find which monitor is being shared.
#[tauri::command]
pub fn share_play_grant<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharePlay>,
    controller_id: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if !supported() {
        return Err("remote control isn't supported on this system".into());
    }
    let target = mapping::pick_monitor(&monitors(&app), width, height).ok_or("no monitor found")?;
    state.send(Msg::Grant(Grant {
        controller_id: parse_id(&controller_id)?,
        target,
    }));
    hotkey(&app, true);
    Ok(())
}

#[tauri::command]
pub fn share_play_revoke<R: Runtime>(app: AppHandle<R>, state: State<'_, SharePlay>) {
    state.revoke();
    hotkey(&app, false);
}

/// One event from the data channel. The sender id comes from the SFU tag,
/// not from the viewer, and is checked against the grant on the input thread.
#[tauri::command]
pub fn share_play_input(
    state: State<'_, SharePlay>,
    sender: String,
    event: InputEvent,
) -> Result<(), String> {
    state.send(Msg::Input(parse_id(&sender)?, event));
    Ok(())
}

fn hotkey<R: Runtime>(app: &AppHandle<R>, on: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let result = if on {
        if gs.is_registered(REVOKE_HOTKEY) {
            return;
        }
        gs.on_shortcut(REVOKE_HOTKEY, |app, _, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                app.state::<SharePlay>().revoke();
                let _ = app.emit(REVOKE_EVENT, ());
            }
        })
    } else {
        gs.unregister(REVOKE_HOTKEY)
    };
    if let Err(e) = result {
        log::warn!("share play hotkey: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::linux_supported;

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
}
