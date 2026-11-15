use crate::features::users::models::User;

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

#[derive(Debug, Clone)]
pub struct ConversationRecord {
    pub id: i64,
    pub kind: Kind,
    pub last_seq: i64,
    pub name: String,
    pub member_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
pub struct Conversation {
    pub id: i64,
    pub kind: Kind,
    pub last_seq: i64,
    pub name: String,
    pub members: Vec<User>,
}

pub fn dm_key(a: i64, b: i64) -> String {
    format!("{}:{}", a.min(b), a.max(b))
}

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
