use chrono::{DateTime, Utc};

pub const CHUNK_SIZE: i64 = 8 * 1024 * 1024;
pub const MAX_FILENAME_CHARS: usize = 255;
pub const MAX_CONTENT_TYPE_LEN: usize = 127;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Uploading,
    Ready,
    Deleting,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uploading => "uploading",
            Self::Ready => "ready",
            Self::Deleting => "deleting",
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Attachment {
    pub id: i64,
    pub conversation_id: i64,
    pub uploader_id: i64,
    pub message_id: Option<i64>,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub chunk_size: i32,
    pub chunk_count: i32,
    pub object_key: String,
    pub upload_id: String,
    pub blake3: Vec<u8>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl Attachment {
    pub fn is_uploading(&self) -> bool {
        self.status == Status::Uploading.as_str()
    }

    pub fn is_ready(&self) -> bool {
        self.status == Status::Ready.as_str()
    }

    pub fn chunk_len(&self, idx: i32) -> i64 {
        let start = idx as i64 * self.chunk_size as i64;
        (self.size - start).min(self.chunk_size as i64)
    }
}

pub fn chunk_count(size: i64) -> i32 {
    ((size + CHUNK_SIZE - 1) / CHUNK_SIZE) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_count_rounds_up() {
        assert_eq!(chunk_count(1), 1);
        assert_eq!(chunk_count(CHUNK_SIZE), 1);
        assert_eq!(chunk_count(CHUNK_SIZE + 1), 2);
    }
}
