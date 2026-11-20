//! Host side of Share Play: check the grant, filter unsafe keys, track what is
//! held so it can all be released when control ends.

use super::mapping::{Rect, to_pixels};

/// One input event from the viewer. Sent as JSON over the data channel.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvent {
    /// Pointer position, 0–1 over the shared screen.
    Move { x: f64, y: f64 },
    /// 0 = left, 1 = middle, 2 = right (DOM `MouseEvent.button`).
    Button { b: u8, down: bool },
    /// Wheel in "lines": positive = down / right.
    Wheel { dx: i32, dy: i32 },
    /// DOM `KeyboardEvent.code` (physical key), e.g. "KeyW".
    Key { code: String, down: bool },
}

/// What actually touches the OS. Enigo in the app, a recorder in tests.
pub trait Backend {
    fn key(&mut self, code: &str, down: bool);
    fn button(&mut self, b: u8, down: bool);
    fn move_to(&mut self, x: i32, y: i32);
    fn scroll(&mut self, dx: i32, dy: i32);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grant {
    pub controller_id: u64,
    pub target: Rect,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    NotGranted,
    Blocked,
    Unknown,
}

#[derive(Default)]
pub struct Controller {
    grant: Option<Grant>,
    held_keys: Vec<String>,
    held_buttons: Vec<u8>,
}

/// Windows / Super key: opens the Start menu and OS shortcuts on the host.
fn is_os_key(code: &str) -> bool {
    matches!(code, "MetaLeft" | "MetaRight" | "OSLeft" | "OSRight")
}

impl Controller {
    /// Start (or retarget) control. A new controller first gets a clean slate.
    pub fn set_grant(&mut self, grant: Grant, os: &mut impl Backend) {
        if self
            .grant
            .is_some_and(|g| g.controller_id != grant.controller_id)
        {
            self.release_all(os);
        }
        self.grant = Some(grant);
    }

    /// End control and let go of everything the remote was holding.
    pub fn revoke(&mut self, os: &mut impl Backend) {
        self.grant = None;
        self.release_all(os);
    }

    pub fn release_all(&mut self, os: &mut impl Backend) {
        for code in std::mem::take(&mut self.held_keys) {
            os.key(&code, false);
        }
        for b in std::mem::take(&mut self.held_buttons) {
            os.button(b, false);
        }
    }

    fn holding(&self, code: &str) -> bool {
        self.held_keys.iter().any(|k| k == code)
    }

    /// Ctrl+Alt+Del can't be injected on Windows anyway (SAS), but block the
    /// combo everywhere so it never half-fires (e.g. X11 logout bindings).
    fn is_secure_attention(&self, code: &str) -> bool {
        let ctrl = self.holding("ControlLeft") || self.holding("ControlRight");
        let alt = self.holding("AltLeft") || self.holding("AltRight");
        ctrl && alt && matches!(code, "Delete" | "NumpadDecimal")
    }

    pub fn apply(
        &mut self,
        sender: u64,
        event: InputEvent,
        os: &mut impl Backend,
    ) -> Result<(), Rejected> {
        let grant = self
            .grant
            .filter(|g| g.controller_id == sender)
            .ok_or(Rejected::NotGranted)?;
        match event {
            InputEvent::Move { x, y } => {
                let (px, py) = to_pixels(grant.target, x, y);
                os.move_to(px, py);
            }
            InputEvent::Button { b, down } => {
                if b > 2 {
                    return Err(Rejected::Unknown);
                }
                let held = self.held_buttons.contains(&b);
                if down && !held {
                    self.held_buttons.push(b);
                    os.button(b, true);
                } else if !down && held {
                    self.held_buttons.retain(|x| *x != b);
                    os.button(b, false);
                }
            }
            InputEvent::Wheel { dx, dy } => {
                os.scroll(dx.clamp(-10, 10), dy.clamp(-10, 10));
            }
            InputEvent::Key { code, down } => {
                if !super::keymap::known(&code) {
                    return Err(Rejected::Unknown);
                }
                if is_os_key(&code) || (down && self.is_secure_attention(&code)) {
                    return Err(Rejected::Blocked);
                }
                let held = self.holding(&code);
                if down && !held {
                    os.key(&code, true);
                    self.held_keys.push(code);
                } else if down {
                    os.key(&code, true); // auto-repeat
                } else if held {
                    self.held_keys.retain(|k| *k != code);
                    os.key(&code, false);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Rec(Vec<String>);
    impl Backend for Rec {
        fn key(&mut self, code: &str, down: bool) {
            self.0.push(format!("key {code} {down}"));
        }
        fn button(&mut self, b: u8, down: bool) {
            self.0.push(format!("button {b} {down}"));
        }
        fn move_to(&mut self, x: i32, y: i32) {
            self.0.push(format!("move {x} {y}"));
        }
        fn scroll(&mut self, dx: i32, dy: i32) {
            self.0.push(format!("scroll {dx} {dy}"));
        }
    }

    const VIEWER: u64 = 7;
    const SCREEN: Rect = Rect {
        x: 100,
        y: 0,
        width: 1001,
        height: 501,
    };

    fn granted() -> (Controller, Rec) {
        let mut c = Controller::default();
        let mut os = Rec::default();
        c.set_grant(
            Grant {
                controller_id: VIEWER,
                target: SCREEN,
            },
            &mut os,
        );
        (c, os)
    }

    fn key(code: &str, down: bool) -> InputEvent {
        InputEvent::Key {
            code: code.into(),
            down,
        }
    }

    #[test]
    fn nothing_applies_without_a_grant() {
        let mut c = Controller::default();
        let mut os = Rec::default();
        assert_eq!(
            c.apply(VIEWER, key("KeyW", true), &mut os),
            Err(Rejected::NotGranted)
        );
        assert!(os.0.is_empty());
    }

    #[test]
    fn only_the_granted_sender_applies() {
        let (mut c, mut os) = granted();
        assert_eq!(
            c.apply(99, key("KeyW", true), &mut os),
            Err(Rejected::NotGranted)
        );
        c.apply(VIEWER, key("KeyW", true), &mut os).unwrap();
        assert_eq!(os.0, ["key KeyW true"]);
    }

    #[test]
    fn move_maps_into_the_shared_screen() {
        let (mut c, mut os) = granted();
        c.apply(VIEWER, InputEvent::Move { x: 0.5, y: 1.0 }, &mut os)
            .unwrap();
        assert_eq!(os.0, ["move 600 500"]);
    }

    #[test]
    fn win_key_and_ctrl_alt_del_are_blocked() {
        let (mut c, mut os) = granted();
        assert_eq!(
            c.apply(VIEWER, key("MetaLeft", true), &mut os),
            Err(Rejected::Blocked)
        );
        c.apply(VIEWER, key("ControlLeft", true), &mut os).unwrap();
        c.apply(VIEWER, key("AltLeft", true), &mut os).unwrap();
        assert_eq!(
            c.apply(VIEWER, key("Delete", true), &mut os),
            Err(Rejected::Blocked)
        );
        assert!(
            !os.0
                .iter()
                .any(|e| e.contains("Meta") || e.contains("Delete"))
        );
        // Delete alone is fine
        c.release_all(&mut os);
        c.apply(VIEWER, key("Delete", true), &mut os).unwrap();
    }

    #[test]
    fn revoke_releases_everything_held() {
        let (mut c, mut os) = granted();
        c.apply(VIEWER, key("KeyW", true), &mut os).unwrap();
        c.apply(VIEWER, key("ShiftLeft", true), &mut os).unwrap();
        c.apply(VIEWER, InputEvent::Button { b: 0, down: true }, &mut os)
            .unwrap();
        os.0.clear();
        c.revoke(&mut os);
        assert_eq!(
            os.0,
            ["key KeyW false", "key ShiftLeft false", "button 0 false"]
        );
        assert_eq!(
            c.apply(VIEWER, key("KeyW", true), &mut os),
            Err(Rejected::NotGranted)
        );
        os.0.clear();
        c.revoke(&mut os);
        assert!(os.0.is_empty(), "nothing left to release");
    }

    #[test]
    fn stray_key_up_is_ignored_and_unknown_keys_rejected() {
        let (mut c, mut os) = granted();
        c.apply(VIEWER, key("KeyA", false), &mut os).unwrap();
        assert!(os.0.is_empty());
        assert_eq!(
            c.apply(VIEWER, key("LaunchMail", true), &mut os),
            Err(Rejected::Unknown)
        );
        assert_eq!(
            c.apply(VIEWER, InputEvent::Button { b: 4, down: true }, &mut os),
            Err(Rejected::Unknown)
        );
    }

    #[test]
    fn new_controller_starts_clean() {
        let (mut c, mut os) = granted();
        c.apply(VIEWER, key("KeyW", true), &mut os).unwrap();
        os.0.clear();
        c.set_grant(
            Grant {
                controller_id: 8,
                target: SCREEN,
            },
            &mut os,
        );
        assert_eq!(os.0, ["key KeyW false"]);
    }

    #[test]
    fn parses_wire_format() {
        let e: InputEvent =
            serde_json::from_str(r#"{"t":"key","code":"KeyW","down":true}"#).unwrap();
        assert_eq!(e, key("KeyW", true));
        let e: InputEvent = serde_json::from_str(r#"{"t":"move","x":0.25,"y":0.5}"#).unwrap();
        assert_eq!(e, InputEvent::Move { x: 0.25, y: 0.5 });
    }
}
