use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::models::Attachment;

// INVARIANT: IDs are strings in JSON because Snowflakes don't fit in a JS number.
#[derive(Debug, Deserialize)]
pub struct StartUploadBody {
    pub conversation_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    /// BLAKE3 of the whole file, 64 hex characters.
    pub blake3: String,
}

#[derive(Debug, Serialize)]
pub struct AttachmentDto {
    pub id: String,
    pub conversation_id: String,
    pub uploader_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub chunk_size: i32,
    pub chunk_count: i32,
    pub blake3: String,
    pub status: String,
    pub expires_at: DateTime<Utc>,
}

impl From<Attachment> for AttachmentDto {
    fn from(a: Attachment) -> Self {
        let blake3 = <[u8; 32]>::try_from(a.blake3.as_slice())
            .map(|b| blake3::Hash::from_bytes(b).to_hex().to_string())
            .unwrap_or_default();
        Self {
            id: a.id.to_string(),
            conversation_id: a.conversation_id.to_string(),
            uploader_id: a.uploader_id.to_string(),
            filename: a.filename,
            content_type: a.content_type,
            size: a.size,
            chunk_size: a.chunk_size,
            chunk_count: a.chunk_count,
            blake3,
            status: a.status,
            expires_at: a.expires_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DownloadDto {
    pub attachment: AttachmentDto,
    /// Short-lived link (a few minutes). Ask again when it runs out.
    pub url: String,
}
