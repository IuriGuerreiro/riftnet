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
    pub peer_id: u64,
    pub sharing_screen: bool,
}

#[derive(Debug, Clone)]
pub struct Call {
    pub id: i64,
    pub conversation_id: i64,
    pub caller_id: i64,
    pub state: CallState,
    pub member_ids: Vec<i64>,
    pub participants: Vec<Participant>,
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
}
