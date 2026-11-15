use std::time::Duration;

/// Nobody answers within this → the call ends as "missed".
pub const RING_TIMEOUT: Duration = Duration::from_secs(30);

/// Same numbers as `CallState` in calls.proto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallState {
    Ringing = 1,
    Active = 2,
}

/// Same numbers as `CallEndReason` in calls.proto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    Hangup = 1,
    Declined = 2,
    Missed = 3,
}

/// One device connected to the SFU.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Participant {
    pub user_id: i64,
    pub device_id: i64,
    /// The media server's id for this device (to remove it later).
    pub peer_id: u64,
    /// This device is sharing its screen.
    pub sharing_screen: bool,
}

#[derive(Debug, Clone)]
pub struct Call {
    pub id: i64,
    pub conversation_id: i64,
    pub caller_id: i64,
    pub state: CallState,
    /// Everyone in the conversation (who gets ring / updates / ended).
    pub member_ids: Vec<i64>,
    pub participants: Vec<Participant>,
}

impl Call {
    /// Users connected right now (a user with 2 devices counts once).
    pub fn participant_user_ids(&self) -> Vec<i64> {
        let mut ids: Vec<i64> = self.participants.iter().map(|p| p.user_id).collect();
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    /// Users sharing their screen right now.
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
}
