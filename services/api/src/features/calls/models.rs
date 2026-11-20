use std::time::Duration;

pub const RING_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallState {
    Ringing = 1,
    Active = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    Hangup = 1,
    Declined = 2,
    Missed = 3,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participant {
    pub user_id: i64,
    pub device_id: i64,
    pub connection_id: u64,
    pub peer_id: u64,
    pub sharing_screen: bool,
    /// The sharer's app can apply remote input (Share Play).
    pub controllable: bool,
}

/// Share Play: who may drive whose screen. One per call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Control {
    pub host_id: i64,
    pub controller_id: i64,
    /// false = requested, waiting for the host.
    pub granted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    Request { host_id: i64 },
    Grant { viewer_id: i64 },
    Deny { viewer_id: i64 },
    Revoke,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlError {
    /// Host isn't sharing a controllable screen, or a party isn't in the call.
    NotAvailable,
    /// Someone else already holds or asked for control.
    Busy,
    /// Caller isn't allowed to do this (wrong side, nothing to answer).
    NotAllowed,
}

#[derive(Debug, Clone)]
pub struct Call {
    pub id: i64,
    pub conversation_id: i64,
    pub caller_id: i64,
    pub state: CallState,
    pub member_ids: Vec<i64>,
    pub participants: Vec<Participant>,
    pub control: Option<Control>,
}

impl Call {
    pub fn participant_user_ids(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self.participants.iter().map(|p| p.user_id).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    pub fn sharing_user_ids(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self
            .participants
            .iter()
            .filter(|p| p.sharing_screen)
            .map(|p| p.user_id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    pub fn controllable_user_ids(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self
            .participants
            .iter()
            .filter(|p| p.sharing_screen && p.controllable)
            .map(|p| p.user_id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    fn in_call(&self, user_id: i64) -> bool {
        self.participants.iter().any(|p| p.user_id == user_id)
    }

    fn can_be_controlled(&self, user_id: i64) -> bool {
        self.participants
            .iter()
            .any(|p| p.user_id == user_id && p.sharing_screen && p.controllable)
    }

    /// Apply a Share Play action by `me`. Rules:
    /// - only a viewer in the call may request, and only from a controllable sharer;
    /// - one control (pending or granted) per call; asking twice is a no-op;
    /// - only the host grants or denies, and only the pending request;
    /// - the host or the controller may revoke at any time.
    pub fn apply_control(&mut self, me: i64, action: ControlAction) -> Result<(), ControlError> {
        match action {
            ControlAction::Request { host_id } => {
                if host_id == me || !self.in_call(me) || !self.can_be_controlled(host_id) {
                    return Err(ControlError::NotAvailable);
                }
                match self.control {
                    Some(c) if c.host_id == host_id && c.controller_id == me => Ok(()),
                    Some(_) => Err(ControlError::Busy),
                    None => {
                        self.control = Some(Control {
                            host_id,
                            controller_id: me,
                            granted: false,
                        });
                        Ok(())
                    }
                }
            }
            ControlAction::Grant { viewer_id } | ControlAction::Deny { viewer_id } => {
                let Some(c) = self.control.as_mut() else {
                    return Err(ControlError::NotAllowed);
                };
                if c.host_id != me || c.controller_id != viewer_id {
                    return Err(ControlError::NotAllowed);
                }
                if matches!(action, ControlAction::Deny { .. }) {
                    self.control = None;
                } else {
                    c.granted = true;
                }
                Ok(())
            }
            ControlAction::Revoke => match self.control {
                Some(c) if c.host_id == me || c.controller_id == me => {
                    self.control = None;
                    Ok(())
                }
                _ => Err(ControlError::NotAllowed),
            },
        }
    }

    /// Drop control once it can't hold any more: the host stopped sharing
    /// (or lost the controllable flag), or either side left the call.
    /// Returns true if it was dropped.
    pub fn settle_control(&mut self) -> bool {
        let Some(c) = self.control else {
            return false;
        };
        if self.can_be_controlled(c.host_id) && self.in_call(c.controller_id) {
            return false;
        }
        self.control = None;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: i64 = 1;
    const VIEWER: i64 = 2;
    const OTHER: i64 = 3;

    fn participant(user_id: i64, sharing: bool) -> Participant {
        Participant {
            user_id,
            device_id: user_id,
            connection_id: user_id as u64,
            peer_id: user_id as u64,
            sharing_screen: sharing,
            controllable: sharing,
        }
    }

    fn call() -> Call {
        Call {
            id: 9,
            conversation_id: 9,
            caller_id: HOST,
            state: CallState::Active,
            member_ids: vec![HOST, VIEWER, OTHER],
            participants: vec![participant(HOST, true), participant(VIEWER, false)],
            control: None,
        }
    }

    fn granted(c: &mut Call) {
        c.apply_control(VIEWER, ControlAction::Request { host_id: HOST })
            .unwrap();
        c.apply_control(HOST, ControlAction::Grant { viewer_id: VIEWER })
            .unwrap();
    }

    #[test]
    fn request_then_grant() {
        let mut c = call();
        c.apply_control(VIEWER, ControlAction::Request { host_id: HOST })
            .unwrap();
        assert_eq!(
            c.control,
            Some(Control {
                host_id: HOST,
                controller_id: VIEWER,
                granted: false
            })
        );
        c.apply_control(HOST, ControlAction::Grant { viewer_id: VIEWER })
            .unwrap();
        assert!(c.control.unwrap().granted);
    }

    #[test]
    fn requesting_twice_is_a_noop() {
        let mut c = call();
        granted(&mut c);
        c.apply_control(VIEWER, ControlAction::Request { host_id: HOST })
            .unwrap();
        assert!(c.control.unwrap().granted);
    }

    #[test]
    fn only_one_controller() {
        let mut c = call();
        c.participants.push(participant(OTHER, false));
        granted(&mut c);
        assert_eq!(
            c.apply_control(OTHER, ControlAction::Request { host_id: HOST }),
            Err(ControlError::Busy)
        );
    }

    #[test]
    fn cannot_request_from_non_sharer_or_self_or_uncontrollable() {
        let mut c = call();
        assert_eq!(
            c.apply_control(HOST, ControlAction::Request { host_id: VIEWER }),
            Err(ControlError::NotAvailable)
        );
        assert_eq!(
            c.apply_control(HOST, ControlAction::Request { host_id: HOST }),
            Err(ControlError::NotAvailable)
        );
        assert_eq!(
            c.apply_control(OTHER, ControlAction::Request { host_id: HOST }),
            Err(ControlError::NotAvailable),
            "not in the call"
        );
        c.participants[0].controllable = false;
        assert_eq!(
            c.apply_control(VIEWER, ControlAction::Request { host_id: HOST }),
            Err(ControlError::NotAvailable)
        );
    }

    #[test]
    fn only_host_grants_the_pending_viewer() {
        let mut c = call();
        c.apply_control(VIEWER, ControlAction::Request { host_id: HOST })
            .unwrap();
        assert_eq!(
            c.apply_control(VIEWER, ControlAction::Grant { viewer_id: VIEWER }),
            Err(ControlError::NotAllowed)
        );
        assert_eq!(
            c.apply_control(HOST, ControlAction::Grant { viewer_id: OTHER }),
            Err(ControlError::NotAllowed)
        );
        assert!(!c.control.unwrap().granted);
    }

    #[test]
    fn deny_clears_the_request() {
        let mut c = call();
        c.apply_control(VIEWER, ControlAction::Request { host_id: HOST })
            .unwrap();
        c.apply_control(HOST, ControlAction::Deny { viewer_id: VIEWER })
            .unwrap();
        assert_eq!(c.control, None);
    }

    #[test]
    fn either_side_can_revoke_but_not_outsiders() {
        for by in [HOST, VIEWER] {
            let mut c = call();
            granted(&mut c);
            c.apply_control(by, ControlAction::Revoke).unwrap();
            assert_eq!(c.control, None);
        }
        let mut c = call();
        granted(&mut c);
        assert_eq!(
            c.apply_control(OTHER, ControlAction::Revoke),
            Err(ControlError::NotAllowed)
        );
    }

    #[test]
    fn control_ends_when_the_stream_stops() {
        let mut c = call();
        granted(&mut c);
        c.participants[0].sharing_screen = false;
        assert!(c.settle_control());
        assert_eq!(c.control, None);
    }

    #[test]
    fn control_ends_when_either_side_leaves() {
        for gone in [HOST, VIEWER] {
            let mut c = call();
            granted(&mut c);
            c.participants.retain(|p| p.user_id != gone);
            assert!(c.settle_control());
        }
    }

    #[test]
    fn settle_keeps_valid_control() {
        let mut c = call();
        granted(&mut c);
        assert!(!c.settle_control());
        assert!(c.control.is_some());
    }
}
