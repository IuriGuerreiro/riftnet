/// A message as stored. `content` is opaque bytes (UTF-8 text for now,
/// encrypted later), so the server never needs to read it.
#[derive(Debug, Clone)]
pub struct Message {
    pub id: i64,
    pub conversation_id: i64,
    pub author_id: i64,
    pub seq: i64,
    pub content: Vec<u8>,
    /// 0 = none, 1 = MLS (matches `Encryption` in messages.proto).
    pub encryption: i8,
}

/// Max size of one message's content (bytes, not characters).
pub const MAX_CONTENT_BYTES: usize = 8 * 1024;
/// Max client nonce length.
pub const MAX_NONCE_LEN: usize = 64;

/// A partition holds ~10 days of one conversation, so it never grows forever.
const BUCKET_MS: u64 = 10 * 24 * 60 * 60 * 1000;

/// Bucket of a moment in time (unix ms).
pub fn bucket_at(ms: u64) -> i32 {
    (ms / BUCKET_MS) as i32
}

/// Bucket a Snowflake id falls in (Snowflakes contain their creation time).
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
}
