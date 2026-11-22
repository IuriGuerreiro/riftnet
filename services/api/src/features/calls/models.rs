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
    pub controllable: bool,
    pub share_id: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Control {
    pub host_id: i64,
    pub controller_id: i64,
    pub granted: bool,
    pub grant_id: i64,
    pub request_id: i64,
    pub host_connection_id: u64,
    pub host_peer_id: u64,
    pub host_share_id: i64,
    pub controller_connection_id: u64,
    pub controller_peer_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    Request { host_id: i64 },
    Grant { viewer_id: i64, request_id: i64 },
    Deny { viewer_id: i64, request_id: i64 },
    Revoke,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlError {
    NotAvailable,
    Busy,
    NotAllowed,
}

#[derive(Debug, Clone)]
pub struct Call {
    pub revision: u64,
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

    fn joined(&self, user_id: i64, connection_id: u64) -> Option<&Participant> {
        self.participants
            .iter()
            .find(|p| p.user_id == user_id && p.connection_id == connection_id)
    }

    fn controllable_share(&self, user_id: i64) -> Option<&Participant> {
        self.participants
            .iter()
            .find(|p| p.user_id == user_id && p.sharing_screen && p.controllable)
    }

    pub fn control_route(&self) -> Option<(u64, u64, u64)> {
        self.control
            .filter(|c| c.granted)
            .map(|c| (c.controller_peer_id, c.host_peer_id, c.grant_id as u64))
    }

    pub fn apply_control(
        &mut self,
        me: i64,
        connection_id: u64,
        action: ControlAction,
        new_id: i64,
    ) -> Result<(), ControlError> {
        match action {
            ControlAction::Request { host_id } => {
                if host_id == me {
                    return Err(ControlError::NotAvailable);
                }
                let viewer = self
                    .joined(me, connection_id)
                    .ok_or(ControlError::NotAvailable)?;
                let host = self
                    .controllable_share(host_id)
                    .ok_or(ControlError::NotAvailable)?;
                let wanted = Control {
                    host_id,
                    controller_id: me,
                    granted: false,
                    grant_id: 0,
                    request_id: new_id,
                    host_connection_id: host.connection_id,
                    host_peer_id: host.peer_id,
                    host_share_id: host.share_id,
                    controller_connection_id: viewer.connection_id,
                    controller_peer_id: viewer.peer_id,
                };
                match self.control {
                    Some(c)
                        if c.host_id == host_id
                            && c.controller_id == me
                            && c.controller_connection_id == connection_id =>
                    {
                        Ok(())
                    }
                    Some(_) => Err(ControlError::Busy),
                    None => {
                        self.control = Some(wanted);
                        Ok(())
                    }
                }
            }
            ControlAction::Grant {
                viewer_id,
                request_id,
            }
            | ControlAction::Deny {
                viewer_id,
                request_id,
            } => {
                let Some(c) = self.control.as_mut() else {
                    return Err(ControlError::NotAllowed);
                };
                if c.host_id != me
                    || c.host_connection_id != connection_id
                    || c.controller_id != viewer_id
                    || c.request_id != request_id
                    || c.granted
                {
                    return Err(ControlError::NotAllowed);
                }
                if matches!(action, ControlAction::Deny { .. }) {
                    self.control = None;
                } else {
                    c.granted = true;
                    c.grant_id = new_id;
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

    pub fn settle_control(&mut self) -> bool {
        let Some(c) = self.control else {
            return false;
        };
        let host_ok = self.participants.iter().any(|p| {
            p.user_id == c.host_id
                && p.connection_id == c.host_connection_id
                && p.peer_id == c.host_peer_id
                && p.sharing_screen
                && p.controllable
                && p.share_id == c.host_share_id
        });
        let viewer_ok = self.participants.iter().any(|p| {
            p.user_id == c.controller_id
                && p.connection_id == c.controller_connection_id
                && p.peer_id == c.controller_peer_id
        });
        if host_ok && viewer_ok {
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
    const HOST_CONN: u64 = 10;
    const VIEWER_CONN: u64 = 20;
    const REQ: i64 = 444;

    fn participant(user_id: i64, sharing: bool) -> Participant {
        Participant {
            user_id,
            device_id: user_id,
            connection_id: user_id as u64 * 10,
            peer_id: user_id as u64 * 100,
            sharing_screen: sharing,
            controllable: sharing,
            share_id: if sharing { 7 } else { 0 },
        }
    }

    fn call() -> Call {
        Call {
            revision: 1,
            id: 9,
            conversation_id: 9,
            caller_id: HOST,
            state: CallState::Active,
            member_ids: vec![HOST, VIEWER, OTHER],
            participants: vec![participant(HOST, true), participant(VIEWER, false)],
            control: None,
        }
    }

    fn request(c: &mut Call) -> Result<(), ControlError> {
        c.apply_control(
            VIEWER,
            VIEWER_CONN,
            ControlAction::Request { host_id: HOST },
            REQ,
        )
    }

    fn grant(c: &mut Call, conn: u64, id: i64) -> Result<(), ControlError> {
        c.apply_control(
            HOST,
            conn,
            ControlAction::Grant {
                viewer_id: VIEWER,
                request_id: REQ,
            },
            id,
        )
    }

    #[test]
    fn grant_must_name_the_current_request() {
        let mut c = call();
        request(&mut c).unwrap();
        assert_eq!(c.control.unwrap().request_id, REQ);
        c.apply_control(VIEWER, VIEWER_CONN, ControlAction::Revoke, 0)
            .unwrap();
        c.apply_control(
            VIEWER,
            VIEWER_CONN,
            ControlAction::Request { host_id: HOST },
            REQ + 1,
        )
        .unwrap();
        assert_eq!(grant(&mut c, HOST_CONN, 555), Err(ControlError::NotAllowed));
        assert!(!c.control.unwrap().granted);
        c.apply_control(
            HOST,
            HOST_CONN,
            ControlAction::Grant {
                viewer_id: VIEWER,
                request_id: REQ + 1,
            },
            556,
        )
        .unwrap();
        assert_eq!(c.control.unwrap().grant_id, 556);
    }

    fn granted(c: &mut Call) {
        request(c).unwrap();
        grant(c, HOST_CONN, 555).unwrap();
    }

    #[test]
    fn request_binds_connections_peers_and_share() {
        let mut c = call();
        request(&mut c).unwrap();
        let k = c.control.unwrap();
        assert!(!k.granted);
        assert_eq!(k.grant_id, 0);
        assert_eq!(
            (k.host_connection_id, k.host_peer_id, k.host_share_id),
            (10, 100, 7)
        );
        assert_eq!(
            (k.controller_connection_id, k.controller_peer_id),
            (20, 200)
        );
        assert_eq!(c.control_route(), None, "nothing relayed while pending");
        grant(&mut c, HOST_CONN, 555).unwrap();
        let k = c.control.unwrap();
        assert!(k.granted);
        assert_eq!(k.grant_id, 555);
        assert_eq!(c.control_route(), Some((200, 100, 555)));
    }

    #[test]
    fn requesting_twice_is_a_noop() {
        let mut c = call();
        granted(&mut c);
        request(&mut c).unwrap();
        assert_eq!(c.control.unwrap().grant_id, 555);
    }

    #[test]
    fn granting_again_is_refused() {
        let mut c = call();
        granted(&mut c);
        assert_eq!(grant(&mut c, HOST_CONN, 556), Err(ControlError::NotAllowed));
        assert_eq!(c.control.unwrap().grant_id, 555);
    }

    #[test]
    fn only_one_controller() {
        let mut c = call();
        c.participants.push(participant(OTHER, false));
        granted(&mut c);
        assert_eq!(
            c.apply_control(OTHER, 30, ControlAction::Request { host_id: HOST }, 0),
            Err(ControlError::Busy)
        );
    }

    #[test]
    fn request_needs_the_joined_connection() {
        let mut c = call();
        assert_eq!(
            c.apply_control(VIEWER, 21, ControlAction::Request { host_id: HOST }, 0),
            Err(ControlError::NotAvailable),
            "second login of the viewer, not in the call"
        );
    }

    #[test]
    fn cannot_request_from_non_sharer_or_self_or_uncontrollable() {
        let mut c = call();
        assert_eq!(
            c.apply_control(
                HOST,
                HOST_CONN,
                ControlAction::Request { host_id: VIEWER },
                0
            ),
            Err(ControlError::NotAvailable)
        );
        assert_eq!(
            c.apply_control(HOST, HOST_CONN, ControlAction::Request { host_id: HOST }, 0),
            Err(ControlError::NotAvailable)
        );
        assert_eq!(
            c.apply_control(OTHER, 30, ControlAction::Request { host_id: HOST }, 0),
            Err(ControlError::NotAvailable),
            "not in the call"
        );
        c.participants[0].controllable = false;
        assert_eq!(request(&mut c), Err(ControlError::NotAvailable));
    }

    #[test]
    fn only_the_hosts_sharing_connection_grants() {
        let mut c = call();
        request(&mut c).unwrap();
        assert_eq!(
            c.apply_control(
                VIEWER,
                VIEWER_CONN,
                ControlAction::Grant {
                    viewer_id: VIEWER,
                    request_id: REQ,
                },
                1
            ),
            Err(ControlError::NotAllowed)
        );
        assert_eq!(
            grant(&mut c, HOST_CONN + 1, 1),
            Err(ControlError::NotAllowed),
            "host's second login (not the sharing connection)"
        );
        assert_eq!(
            c.apply_control(
                HOST,
                HOST_CONN,
                ControlAction::Grant {
                    viewer_id: OTHER,
                    request_id: REQ,
                },
                1
            ),
            Err(ControlError::NotAllowed)
        );
        assert!(!c.control.unwrap().granted);
        assert_eq!(
            c.apply_control(
                HOST,
                HOST_CONN + 1,
                ControlAction::Deny {
                    viewer_id: VIEWER,
                    request_id: REQ,
                },
                0
            ),
            Err(ControlError::NotAllowed)
        );
    }

    #[test]
    fn deny_clears_the_request() {
        let mut c = call();
        request(&mut c).unwrap();
        c.apply_control(
            HOST,
            HOST_CONN,
            ControlAction::Deny {
                viewer_id: VIEWER,
                request_id: REQ,
            },
            0,
        )
        .unwrap();
        assert_eq!(c.control, None);
    }

    #[test]
    fn either_side_can_revoke_from_any_connection_but_not_outsiders() {
        for (by, conn) in [(HOST, HOST_CONN + 1), (VIEWER, VIEWER_CONN + 1)] {
            let mut c = call();
            granted(&mut c);
            c.apply_control(by, conn, ControlAction::Revoke, 0).unwrap();
            assert_eq!(c.control, None);
        }
        let mut c = call();
        granted(&mut c);
        assert_eq!(
            c.apply_control(OTHER, 30, ControlAction::Revoke, 0),
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
    fn control_ends_when_the_host_restarts_the_share() {
        let mut c = call();
        granted(&mut c);
        c.participants[0].share_id = 8;
        assert!(c.settle_control());
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
    fn control_ends_when_a_bound_peer_changes() {
        let mut c = call();
        granted(&mut c);
        c.participants[1].peer_id = 201;
        assert!(c.settle_control());
    }

    #[test]
    fn settle_keeps_valid_control() {
        let mut c = call();
        granted(&mut c);
        assert!(!c.settle_control());
        assert!(c.control.is_some());
    }
}
