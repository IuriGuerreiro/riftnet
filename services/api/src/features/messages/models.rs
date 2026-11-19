#[derive(Debug, Clone)]
pub struct Message {
    pub id: i64,
    pub conversation_id: i64,
    pub author_id: i64,
    pub seq: i64,
    pub content: Vec<u8>,
    pub encryption: i8,
    pub edited_at: i64,
    pub attachments: Vec<MessageAttachment>,
    /// Id of the message this replies to, 0 = not a reply. Kept after the original is deleted.
    pub reply_to: i64,
    /// Per viewer (`me`), filled by the service. Never stored on the row.
    pub reactions: Vec<ReactionCount>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionCount {
    pub emoji: String,
    pub count: u32,
    pub me: bool,
}

/// One stored reaction row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionRow {
    pub message_id: i64,
    pub emoji: String,
    pub user_id: i64,
}

/// Groups rows of one message into counts, in first-seen order.
pub fn count_reactions<'a>(
    rows: impl IntoIterator<Item = &'a ReactionRow>,
    me: i64,
) -> Vec<ReactionCount> {
    let mut out: Vec<ReactionCount> = Vec::new();
    for r in rows {
        match out.iter_mut().find(|c| c.emoji == r.emoji) {
            Some(c) => {
                c.count += 1;
                c.me |= r.user_id == me;
            }
            None => out.push(ReactionCount {
                emoji: r.emoji.clone(),
                count: 1,
                me: r.user_id == me,
            }),
        }
    }
    out
}

pub const MAX_DISTINCT_REACTIONS: usize = 20;
pub const MAX_EMOJI_BYTES: usize = 32;
pub const MAX_REACTORS: usize = 100;

/// A Unicode emoji (or a short sequence of them): no letters, digits,
/// spaces or control characters, and at least one non-ASCII char.
pub fn is_valid_emoji(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_EMOJI_BYTES
        && !s.is_ascii()
        && !s
            .chars()
            .any(|c| c.is_alphanumeric() || c.is_whitespace() || c.is_control())
}

/// A file's details as shown on the message. A copy made at send; the
/// upload itself lives in the attachments feature (Postgres + file store).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageAttachment {
    pub id: i64,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub blake3: Vec<u8>,
    pub expires_at_ms: i64,
    /// Inline link for images/videos, signed per response. Never stored.
    pub preview_url: String,
}

impl MessageAttachment {
    /// Images and videos get an inline preview link.
    pub fn is_media(&self) -> bool {
        is_media_type(&self.content_type)
    }
}

// WARN: no SVG. It can carry scripts, and the uploader picks the content type.
pub fn is_media_type(content_type: &str) -> bool {
    let t = content_type.to_ascii_lowercase();
    (t.starts_with("image/") && !t.starts_with("image/svg")) || t.starts_with("video/")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessageChange {
    pub seq: i64,
    pub message_id: i64,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Edit = 1,
    Delete = 2,
    /// A reaction was added or removed. Sync treats it like an edit.
    Reaction = 3,
}

impl ChangeKind {
    pub fn from_i8(v: i8) -> Option<Self> {
        match v {
            1 => Some(Self::Edit),
            2 => Some(Self::Delete),
            3 => Some(Self::Reaction),
            _ => None,
        }
    }
}

pub const MAX_CONTENT_BYTES: usize = 8 * 1024;
pub const MAX_SYNC: usize = 200;
pub const MAX_NONCE_LEN: usize = 64;
pub const MAX_ATTACHMENTS: usize = 10;

const BUCKET_MS: u64 = 10 * 24 * 60 * 60 * 1000;

pub fn bucket_at(ms: u64) -> i32 {
    (ms / BUCKET_MS) as i32
}

pub fn bucket_of(id: i64) -> i32 {
    bucket_at(common::snowflake::timestamp_ms(id as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_are_ten_days() {
        assert_eq!(bucket_at(0), 0);
        assert_eq!(bucket_at(BUCKET_MS - 1), 0);
        assert_eq!(bucket_at(BUCKET_MS), 1);
    }

    #[test]
    fn emoji_check() {
        for ok in ["👍", "❤️", "👨‍👩‍👧", "🇵🇹", "🦀"] {
            assert!(is_valid_emoji(ok), "{ok}");
        }
        for bad in ["", "a", ":)", "é", "👍 ", "\u{200b}x"] {
            assert!(!is_valid_emoji(bad), "{bad:?}");
        }
    }

    #[test]
    fn counts_group_by_emoji_and_flag_me() {
        let row = |emoji: &str, user_id| ReactionRow {
            message_id: 1,
            emoji: emoji.into(),
            user_id,
        };
        let rows = [row("👍", 1), row("🎉", 2), row("👍", 2)];
        let c = count_reactions(&rows, 2);
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].emoji.as_str(), c[0].count, c[0].me), ("👍", 2, true));
        assert_eq!((c[1].emoji.as_str(), c[1].count, c[1].me), ("🎉", 1, true));
        assert!(!count_reactions(&rows, 9)[0].me);
    }
}
