#[derive(Debug, Clone)]
pub struct Message {
    pub id: i64,
    pub conversation_id: i64,
    pub author_id: i64,
    pub seq: i64,
    pub content: Vec<u8>,
    pub encryption: i8,
}

pub const MAX_CONTENT_BYTES: usize = 8 * 1024;
pub const MAX_SYNC: usize = 200;
pub const MAX_NONCE_LEN: usize = 64;

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
}
