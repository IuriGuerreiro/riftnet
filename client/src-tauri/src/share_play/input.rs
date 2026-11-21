//! Host side of Share Play: local approval, single-use grants, a lease,
//! the key policy, and tracking what is held so it can all be released.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use super::keymap::{Key, Named, to_key};
use super::mapping::{Rect, to_pixels};

/// The viewer pings every 500 ms; no traffic for this long ends control.
pub const LEASE: Duration = Duration::from_secs(2);
/// A local Approve click is good for one grant within this window.
pub const APPROVAL_TTL: Duration = Duration::from_secs(30);

/// One input event from the viewer. Sent as JSON over the data channel.
/// Clicks and wheel carry their own position so they can't land elsewhere.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvent {
    /// Pointer position, 0–1 over the shared screen.
    Move { x: f64, y: f64 },
    /// 0 = left, 1 = middle, 2 = right (DOM `MouseEvent.button`).
    Button { b: u8, down: bool, x: f64, y: f64 },
    /// Wheel in "lines": positive = down / right.
    Wheel { dx: i32, dy: i32, x: f64, y: f64 },
    /// DOM `KeyboardEvent.code` (physical key), e.g. "KeyW".
    Key { code: String, down: bool },
    /// Viewer heartbeat: keeps the lease alive.
    Ping,
}

/// What actually touches the OS. Enigo in the app, a recorder in tests.
pub trait Backend {
    fn key(&mut self, key: Key, down: bool) -> bool;
    fn button(&mut self, b: u8, down: bool) -> bool;
    fn move_to(&mut self, x: i32, y: i32);
    fn scroll(&mut self, dx: i32, dy: i32);
    /// Where the OS cursor is now, if the platform can tell.
    fn location(&self) -> Option<(i32, i32)>;
}

/// Where one input event came from, per the SFU tag and channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tag {
    pub sender: u64,
    pub grant_id: u64,
    pub lossy: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grant {
    pub grant_id: u64,
    pub controller_id: u64,
    pub target: Rect,
}

#[derive(Debug, Clone, Copy)]
struct Approval {
    controller_id: u64,
    request_id: u64,
    target: Rect,
    at: Instant,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    NotGranted,
    Blocked,
    Unknown,
    /// Coordinates missing / outside the share, or the cursor didn't get there.
    OffTarget,
    /// Not a pointer move, but arrived on the lossy channel.
    WrongChannel,
    NativeFailure,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ArmError {
    /// No fresh local Approve click for this viewer and request.
    NotApproved,
    /// This grant id was armed before (stale update after a revoke).
    Stale,
    CleanupPending,
}

#[derive(Default)]
pub struct Controller {
    approval: Option<Approval>,
    grant: Option<Grant>,
    used_grants: HashSet<u64>,
    lease_until: Option<Instant>,
    held_keys: Vec<Key>,
    held_buttons: Vec<u8>,
}

impl Controller {
    #[cfg(test)]
    pub fn armed(&self) -> Option<Grant> {
        self.grant
    }

    /// The host clicked Approve here, for this request and this monitor.
    pub fn approve(&mut self, controller_id: u64, request_id: u64, target: Rect, now: Instant) {
        self.approval = Some(Approval {
            controller_id,
            request_id,
            target,
            at: now,
        });
    }

    /// The server confirmed a grant. Arms only once per grant id, and only
    /// with a fresh local approval of that exact request (which it consumes).
    pub fn arm(
        &mut self,
        grant_id: u64,
        controller_id: u64,
        request_id: u64,
        now: Instant,
        os: &mut impl Backend,
    ) -> Result<(), ArmError> {
        if self.used_grants.contains(&grant_id) {
            return Err(ArmError::Stale);
        }
        let approval = self
            .approval
            .take()
            .filter(|a| a.controller_id == controller_id && a.request_id == request_id)
            .filter(|a| now.saturating_duration_since(a.at) <= APPROVAL_TTL)
            .ok_or(ArmError::NotApproved)?;
        self.used_grants.insert(grant_id);
        self.release_all(os);
        if !self.held_keys.is_empty() || !self.held_buttons.is_empty() {
            self.grant = None;
            return Err(ArmError::CleanupPending);
        }
        self.grant = Some(Grant {
            grant_id,
            controller_id,
            target: approval.target,
        });
        self.lease_until = Some(now + LEASE);
        Ok(())
    }

    /// End control, forget any pending approval, let go of everything held.
    pub fn revoke(&mut self, os: &mut impl Backend) {
        self.grant = None;
        self.approval = None;
        self.lease_until = None;
        self.release_all(os);
    }

    /// Revoke when the lease ran out. Returns true if it did.
    pub fn tick(&mut self, now: Instant, os: &mut impl Backend) -> bool {
        if self.grant.is_none() {
            self.release_all(os);
        }
        if self.grant.is_some() && self.lease_until.is_some_and(|t| now > t) {
            self.revoke(os);
            return true;
        }
        false
    }

    pub fn release_all(&mut self, os: &mut impl Backend) {
        self.held_keys.retain(|key| !os.key(*key, false));
        self.held_buttons.retain(|b| !os.button(*b, false));
    }

    fn holding(&self, key: Key) -> bool {
        self.held_keys.contains(&key)
    }

    /// Policy on canonical keys (after mapping, so no spelling gets around it).
    /// Delete is blocked outright: we can't verify the host's real modifier
    /// state, so Ctrl+Alt+Del could otherwise be assembled. On Linux,
    /// Backspace and F-keys are also refused regardless of remote modifiers.
    fn blocked(&self, key: Key) -> bool {
        match key {
            Key::Named(Named::Delete) => true,
            Key::Named(Named::Backspace | Named::F(_)) => {
                cfg!(target_os = "linux")
                    || (self.holding(Key::Named(Named::Control))
                        && self.holding(Key::Named(Named::Alt)))
            }
            Key::Char(c) => !c.is_ascii_graphic(),
            _ => false,
        }
    }

    /// Move to the event's point and confirm the cursor is there. If the OS
    /// can't say where the cursor is, that's a refusal too.
    fn point(&self, target: Rect, x: f64, y: f64, os: &mut impl Backend) -> Result<(), Rejected> {
        let (px, py) = to_pixels(target, x, y).ok_or(Rejected::OffTarget)?;
        os.move_to(px, py);
        match os.location() {
            Some(at) if at == (px, py) => Ok(()),
            _ => Err(Rejected::OffTarget),
        }
    }

    /// `sender` and `grant_id` come from the SFU tag. Input relayed under
    /// an older grant is dropped, even from the same viewer. `lossy` = it
    /// came on the unordered channel, which may only carry moves.
    pub fn apply(
        &mut self,
        from: Tag,
        event: InputEvent,
        now: Instant,
        os: &mut impl Backend,
    ) -> Result<(), Rejected> {
        let grant = self
            .grant
            .filter(|g| g.controller_id == from.sender && g.grant_id == from.grant_id)
            .ok_or(Rejected::NotGranted)?;
        if from.lossy && !matches!(event, InputEvent::Move { .. }) {
            return Err(Rejected::WrongChannel);
        }
        self.lease_until = Some(now + LEASE);
        match event {
            InputEvent::Ping => {}
            InputEvent::Move { x, y } => {
                let (px, py) = to_pixels(grant.target, x, y).ok_or(Rejected::OffTarget)?;
                os.move_to(px, py);
            }
            InputEvent::Button { b, down, x, y } => {
                if b > 2 {
                    return Err(Rejected::Unknown);
                }
                let held = self.held_buttons.contains(&b);
                if down && !held {
                    self.point(grant.target, x, y, os)?;
                    self.held_buttons.push(b);
                    os.button(b, true);
                } else if !down && held {
                    // Always release, even off target: never leave it stuck.
                    let _ = self.point(grant.target, x, y, os);
                    if os.button(b, false) {
                        self.held_buttons.retain(|h| *h != b);
                    } else {
                        return Err(Rejected::NativeFailure);
                    }
                }
            }
            InputEvent::Wheel { dx, dy, x, y } => {
                self.point(grant.target, x, y, os)?;
                os.scroll(dx.clamp(-10, 10), dy.clamp(-10, 10));
            }
            InputEvent::Key { code, down } => {
                let key =
                    to_key(&code).ok_or(if code.starts_with("Meta") || code.starts_with("OS") {
                        Rejected::Blocked
                    } else {
                        Rejected::Unknown
                    })?;
                let held = self.holding(key);
                if down && self.blocked(key) {
                    return Err(Rejected::Blocked);
                }
                if down {
                    os.key(key, true); // repeats too
                    if !held {
                        self.held_keys.push(key);
                    }
                } else if held {
                    if os.key(key, false) {
                        self.held_keys.retain(|k| *k != key);
                    } else {
                        return Err(Rejected::NativeFailure);
                    }
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
    struct Rec {
        log: Vec<String>,
        cursor: Option<(i32, i32)>,
        /// Simulate the OS refusing/clamping the move.
        stuck: bool,
        fail_release: bool,
    }
    impl Backend for Rec {
        fn key(&mut self, key: Key, down: bool) -> bool {
            self.log.push(format!("key {key:?} {down}"));
            down || !self.fail_release
        }
        fn button(&mut self, b: u8, down: bool) -> bool {
            self.log.push(format!("button {b} {down}"));
            down || !self.fail_release
        }
        fn move_to(&mut self, x: i32, y: i32) {
            self.log.push(format!("move {x} {y}"));
            if !self.stuck {
                self.cursor = Some((x, y));
            }
        }
        fn scroll(&mut self, dx: i32, dy: i32) {
            self.log.push(format!("scroll {dx} {dy}"));
        }
        fn location(&self) -> Option<(i32, i32)> {
            self.cursor
        }
    }

    const VIEWER: u64 = 7;
    const GRANT: u64 = 900;
    const REQ: u64 = 300;
    const FROM: Tag = Tag {
        sender: VIEWER,
        grant_id: GRANT,
        lossy: false,
    };
    const SCREEN: Rect = Rect {
        x: 100,
        y: 0,
        width: 1001,
        height: 501,
    };

    fn granted() -> (Controller, Rec, Instant) {
        let mut c = Controller::default();
        let mut os = Rec {
            cursor: Some((0, 0)),
            ..Rec::default()
        };
        let now = Instant::now();
        c.approve(VIEWER, REQ, SCREEN, now);
        c.arm(GRANT, VIEWER, REQ, now, &mut os).unwrap();
        (c, os, now)
    }

    fn key(code: &str, down: bool) -> InputEvent {
        InputEvent::Key {
            code: code.into(),
            down,
        }
    }

    fn click(down: bool, x: f64, y: f64) -> InputEvent {
        InputEvent::Button { b: 0, down, x, y }
    }

    #[test]
    fn failed_releases_are_retried_and_block_rearming() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, key("KeyW", true), now, &mut os).unwrap();
        c.apply(FROM, click(true, 0.1, 0.1), now, &mut os).unwrap();
        os.fail_release = true;
        c.revoke(&mut os);
        assert_eq!(c.held_keys.len(), 1);
        assert_eq!(c.held_buttons.len(), 1);
        c.approve(VIEWER, REQ, SCREEN, now);
        assert_eq!(
            c.arm(GRANT + 1, VIEWER, REQ, now, &mut os),
            Err(ArmError::CleanupPending)
        );
        os.fail_release = false;
        c.tick(now, &mut os);
        assert!(c.held_keys.is_empty());
        assert!(c.held_buttons.is_empty());
    }

    #[test]
    fn nothing_applies_without_a_grant() {
        let mut c = Controller::default();
        let mut os = Rec::default();
        assert_eq!(
            c.apply(FROM, key("KeyW", true), Instant::now(), &mut os),
            Err(Rejected::NotGranted)
        );
        assert!(os.log.is_empty());
    }

    #[test]
    fn arming_needs_a_local_approval_for_that_viewer() {
        let mut c = Controller::default();
        let mut os = Rec::default();
        let now = Instant::now();
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ, now, &mut os),
            Err(ArmError::NotApproved)
        );
        c.approve(8, REQ, SCREEN, now);
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ, now, &mut os),
            Err(ArmError::NotApproved),
            "other viewer"
        );
        c.approve(VIEWER, REQ, SCREEN, now);
        assert_eq!(
            c.arm(
                GRANT,
                VIEWER,
                REQ,
                now + APPROVAL_TTL + Duration::from_secs(1),
                &mut os
            ),
            Err(ArmError::NotApproved),
            "approval expired"
        );
    }

    #[test]
    fn stale_grant_cannot_rearm_after_revoke() {
        let (mut c, mut os, now) = granted();
        c.revoke(&mut os);
        // A queued CallUpdated replays the old grant.
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ, now, &mut os),
            Err(ArmError::Stale)
        );
        // Even with a new approval, the old id stays dead.
        c.approve(VIEWER, REQ, SCREEN, now);
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ, now, &mut os),
            Err(ArmError::Stale)
        );
        // A new grant id needs that fresh approval, and it's single-use.
        c.arm(GRANT + 1, VIEWER, REQ, now, &mut os).unwrap();
        c.revoke(&mut os);
        assert_eq!(
            c.arm(GRANT + 2, VIEWER, REQ, now, &mut os),
            Err(ArmError::NotApproved)
        );
    }

    #[test]
    fn revoke_drops_a_pending_approval() {
        let mut c = Controller::default();
        let mut os = Rec::default();
        let now = Instant::now();
        c.approve(VIEWER, REQ, SCREEN, now);
        c.revoke(&mut os);
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ, now, &mut os),
            Err(ArmError::NotApproved)
        );
    }

    #[test]
    fn only_the_granted_sender_applies() {
        let (mut c, mut os, now) = granted();
        assert_eq!(
            c.apply(Tag { sender: 99, ..FROM }, key("KeyW", true), now, &mut os),
            Err(Rejected::NotGranted)
        );
        c.apply(FROM, key("KeyW", true), now, &mut os).unwrap();
        assert_eq!(os.log, ["key Char('w') true"]);
    }

    #[test]
    fn lease_expires_and_releases_everything() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, key("KeyW", true), now, &mut os).unwrap();
        assert!(!c.tick(now + LEASE / 2, &mut os));
        c.apply(FROM, InputEvent::Ping, now + LEASE / 2, &mut os)
            .unwrap();
        assert!(!c.tick(now + LEASE, &mut os), "ping renewed it");
        os.log.clear();
        assert!(c.tick(now + LEASE * 2, &mut os));
        assert_eq!(os.log, ["key Char('w') false"]);
        assert!(c.armed().is_none());
    }

    #[test]
    fn move_maps_into_the_shared_screen_and_refuses_outside() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, InputEvent::Move { x: 0.5, y: 1.0 }, now, &mut os)
            .unwrap();
        assert_eq!(os.log, ["move 600 500"]);
        assert_eq!(
            c.apply(FROM, InputEvent::Move { x: 1.5, y: 0.0 }, now, &mut os),
            Err(Rejected::OffTarget)
        );
    }

    #[test]
    fn click_carries_its_position_and_lands_there() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, click(true, 0.0, 0.0), now, &mut os).unwrap();
        assert_eq!(os.log, ["move 100 0", "button 0 true"]);
        assert_eq!(
            c.apply(
                FROM,
                InputEvent::Wheel {
                    dx: 0,
                    dy: 3,
                    x: 2.0,
                    y: 0.0
                },
                now,
                &mut os
            ),
            Err(Rejected::OffTarget)
        );
    }

    #[test]
    fn click_is_refused_if_the_cursor_did_not_get_there() {
        let (mut c, mut os, now) = granted();
        os.stuck = true;
        assert_eq!(
            c.apply(FROM, click(true, 0.5, 0.5), now, &mut os),
            Err(Rejected::OffTarget)
        );
        assert!(!os.log.iter().any(|l| l.starts_with("button")));
    }

    #[test]
    fn button_up_always_releases() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, click(true, 0.5, 0.5), now, &mut os).unwrap();
        os.log.clear();
        c.apply(FROM, click(false, 9.0, 9.0), now, &mut os).unwrap();
        assert_eq!(os.log, ["button 0 false"]);
    }

    #[test]
    fn os_key_delete_and_ctrl_alt_combos_are_blocked() {
        let (mut c, mut os, now) = granted();
        assert_eq!(
            c.apply(FROM, key("MetaLeft", true), now, &mut os),
            Err(Rejected::Blocked)
        );
        assert_eq!(
            c.apply(FROM, key("Delete", true), now, &mut os),
            Err(Rejected::Blocked),
            "always"
        );
        assert_eq!(
            c.apply(FROM, key("NumpadDecimal", true), now, &mut os),
            Err(Rejected::Blocked)
        );
        assert_eq!(
            c.apply(FROM, key("Key\u{7f}", true), now, &mut os),
            Err(Rejected::Unknown)
        );
        c.apply(FROM, key("ControlRight", true), now, &mut os)
            .unwrap();
        c.apply(FROM, key("AltLeft", true), now, &mut os).unwrap();
        assert_eq!(
            c.apply(FROM, key("Backspace", true), now, &mut os),
            Err(Rejected::Blocked)
        );
        assert_eq!(
            c.apply(FROM, key("F2", true), now, &mut os),
            Err(Rejected::Blocked)
        );
        assert!(
            !os.log
                .iter()
                .any(|e| e.contains("Delete") || e.contains("Backspace") || e.contains("F("))
        );
        c.release_all(&mut os);
        assert_eq!(
            c.apply(FROM, key("Backspace", true), now, &mut os).is_err(),
            cfg!(target_os = "linux")
        );
    }

    #[test]
    fn modifiers_are_tracked_canonically() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, key("ControlLeft", true), now, &mut os)
            .unwrap();
        c.apply(FROM, key("AltRight", true), now, &mut os).unwrap();
        assert!(c.blocked(Key::Named(Named::F(1))));
    }

    #[test]
    fn revoke_releases_everything_held() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, key("KeyW", true), now, &mut os).unwrap();
        c.apply(FROM, key("ShiftLeft", true), now, &mut os).unwrap();
        c.apply(FROM, click(true, 0.1, 0.1), now, &mut os).unwrap();
        os.log.clear();
        c.revoke(&mut os);
        assert_eq!(
            os.log,
            [
                "key Char('w') false",
                "key Named(Shift) false",
                "button 0 false"
            ]
        );
        assert_eq!(
            c.apply(FROM, key("KeyW", true), now, &mut os),
            Err(Rejected::NotGranted)
        );
        os.log.clear();
        c.revoke(&mut os);
        assert!(os.log.is_empty(), "nothing left to release");
    }

    #[test]
    fn stray_key_up_is_ignored_and_unknown_keys_rejected() {
        let (mut c, mut os, now) = granted();
        c.apply(FROM, key("KeyA", false), now, &mut os).unwrap();
        assert!(os.log.is_empty());
        assert_eq!(
            c.apply(FROM, key("LaunchMail", true), now, &mut os),
            Err(Rejected::Unknown)
        );
        assert_eq!(
            c.apply(
                FROM,
                InputEvent::Button {
                    b: 4,
                    down: true,
                    x: 0.0,
                    y: 0.0
                },
                now,
                &mut os
            ),
            Err(Rejected::Unknown)
        );
    }

    #[test]
    fn click_and_wheel_need_a_known_cursor_position() {
        let (mut c, mut os, now) = granted();
        os.cursor = None;
        os.stuck = true;
        assert_eq!(
            c.apply(FROM, click(true, 0.5, 0.5), now, &mut os),
            Err(Rejected::OffTarget)
        );
        assert_eq!(
            c.apply(
                FROM,
                InputEvent::Wheel {
                    dx: 0,
                    dy: 1,
                    x: 0.5,
                    y: 0.5
                },
                now,
                &mut os
            ),
            Err(Rejected::OffTarget)
        );
        assert!(
            !os.log
                .iter()
                .any(|l| l.starts_with("button") || l.starts_with("scroll"))
        );
    }

    #[test]
    fn approval_is_for_one_request() {
        let mut c = Controller::default();
        let mut os = Rec::default();
        let now = Instant::now();
        c.approve(VIEWER, REQ, SCREEN, now);
        // The viewer re-requested; the server grants the new request.
        assert_eq!(
            c.arm(GRANT, VIEWER, REQ + 1, now, &mut os),
            Err(ArmError::NotApproved)
        );
        assert!(c.armed().is_none());
    }

    #[test]
    fn input_from_an_older_grant_is_dropped() {
        let (mut c, mut os, now) = granted();
        c.revoke(&mut os);
        c.approve(VIEWER, REQ, SCREEN, now);
        c.arm(GRANT + 1, VIEWER, REQ, now, &mut os).unwrap();
        // Queued before the revoke, tagged with the old grant.
        assert_eq!(
            c.apply(FROM, key("KeyW", true), now, &mut os),
            Err(Rejected::NotGranted)
        );
        let new = Tag {
            grant_id: GRANT + 1,
            ..FROM
        };
        c.apply(new, key("KeyW", true), now, &mut os).unwrap();
        assert_eq!(os.log, ["key Char('w') true"]);
    }

    #[test]
    fn lossy_channel_takes_moves_only() {
        let (mut c, mut os, now) = granted();
        let lossy = Tag {
            lossy: true,
            ..FROM
        };
        for e in [
            key("KeyW", true),
            click(true, 0.5, 0.5),
            InputEvent::Ping,
            InputEvent::Wheel {
                dx: 0,
                dy: 1,
                x: 0.5,
                y: 0.5,
            },
        ] {
            assert_eq!(c.apply(lossy, e, now, &mut os), Err(Rejected::WrongChannel));
        }
        assert!(os.log.is_empty());
        c.apply(lossy, InputEvent::Move { x: 0.0, y: 0.0 }, now, &mut os)
            .unwrap();
        assert_eq!(os.log, ["move 100 0"]);
    }

    #[test]
    fn parses_wire_format() {
        let e: InputEvent =
            serde_json::from_str(r#"{"t":"key","code":"KeyW","down":true}"#).unwrap();
        assert_eq!(e, key("KeyW", true));
        let e: InputEvent =
            serde_json::from_str(r#"{"t":"button","b":0,"down":true,"x":0.25,"y":0.5}"#).unwrap();
        assert_eq!(e, click(true, 0.25, 0.5));
        let e: InputEvent = serde_json::from_str(r#"{"t":"ping"}"#).unwrap();
        assert_eq!(e, InputEvent::Ping);
        assert!(
            serde_json::from_str::<InputEvent>(r#"{"t":"button","b":0,"down":true}"#).is_err(),
            "click needs coords"
        );
    }
}
