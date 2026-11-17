use chrono::{DateTime, Utc};

pub const MAX_PENDING_OUTGOING: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
pub enum FriendshipStatus {
    Pending,
    Accepted,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Friendship {
    pub user_low: i64,
    pub user_high: i64,
    pub requester_id: i64,
    pub status: FriendshipStatus,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
}

impl Friendship {
    pub fn other(&self, me: i64) -> i64 {
        if self.user_low == me {
            self.user_high
        } else {
            self.user_low
        }
    }

    pub fn state_for(&self, me: i64) -> FriendState {
        match self.status {
            FriendshipStatus::Accepted => FriendState::Friend,
            FriendshipStatus::Pending if self.requester_id == me => FriendState::Outgoing,
            FriendshipStatus::Pending => FriendState::Incoming,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FriendState {
    None,
    Incoming,
    Outgoing,
    Friend,
}

pub fn ordered_pair(a: i64, b: i64) -> (i64, i64) {
    if a < b { (a, b) } else { (b, a) }
}
