use chrono::{DateTime, Utc};

/// Max pending requests one user can have sent and not yet answered.
pub const MAX_PENDING_OUTGOING: i64 = 100;

/// Stored as TEXT ('pending' / 'accepted'). `sqlx::Type` maps the enum to
/// that column, so we never compare raw strings in Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
pub enum FriendshipStatus {
    Pending,
    Accepted,
}

/// One row of `friendships`: a pending request or an accepted friendship.
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
    /// The other person in the pair, seen from `me`.
    pub fn other(&self, me: i64) -> i64 {
        if self.user_low == me {
            self.user_high
        } else {
            self.user_low
        }
    }

    /// How this row looks from `me`'s side.
    pub fn state_for(&self, me: i64) -> FriendState {
        match self.status {
            FriendshipStatus::Accepted => FriendState::Friend,
            FriendshipStatus::Pending if self.requester_id == me => FriendState::Outgoing,
            FriendshipStatus::Pending => FriendState::Incoming,
        }
    }
}

/// A relationship from one user's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FriendState {
    /// Nothing between us (after decline, cancel or remove).
    None,
    /// They sent me a request.
    Incoming,
    /// I sent them a request.
    Outgoing,
    Friend,
}

/// The pair in storage order: smaller id first.
pub fn ordered_pair(a: i64, b: i64) -> (i64, i64) {
    if a < b { (a, b) } else { (b, a) }
}
