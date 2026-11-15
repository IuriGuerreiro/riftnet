use crate::features::users::models::User;

/// Same numbers as `ConversationKind` in conversations.proto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i8)]
pub enum Kind {
    Dm = 1,
    Group = 2,
}

impl Kind {
    pub fn from_db(v: i8) -> Self {
        if v == 2 { Self::Group } else { Self::Dm }
    }
}

/// What the database stores: members are just ids.
#[derive(Debug, Clone)]
pub struct ConversationRecord {
    pub id: i64,
    pub kind: Kind,
    pub last_seq: i64,
    /// Group name; empty for DMs.
    pub name: String,
    pub member_ids: Vec<i64>,
}

/// What the app sends: members with their profiles (from the users table).
#[derive(Debug, Clone)]
pub struct Conversation {
    pub id: i64,
    pub kind: Kind,
    pub last_seq: i64,
    /// Group name; empty for DMs.
    pub name: String,
    pub members: Vec<User>,
}

/// The one DM between two users, whichever order they come in.
pub fn dm_key(a: i64, b: i64) -> String {
    format!("{}:{}", a.min(b), a.max(b))
}

/// Group DMs: 3 to 5 people (2 would be a DM).
pub const MIN_GROUP_MEMBERS: usize = 3;
pub const MAX_GROUP_MEMBERS: usize = 5;
pub const MAX_GROUP_NAME_CHARS: usize = 100;

#[cfg(test)]
mod tests {
    #[test]
    fn dm_key_is_the_same_both_ways() {
        assert_eq!(super::dm_key(5, 9), "5:9");
        assert_eq!(super::dm_key(9, 5), "5:9");
    }
}
