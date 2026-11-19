use protocol::v1;

use super::models::{Message, MessageAttachment};

impl From<&Message> for v1::Message {
    fn from(m: &Message) -> Self {
        Self {
            id: m.id as u64,
            conversation_id: m.conversation_id as u64,
            author_id: m.author_id as u64,
            seq: m.seq as u64,
            content: m.content.clone(),
            encryption: i32::from(m.encryption),
            edited_at: m.edited_at as u64,
            attachments: m.attachments.iter().map(Into::into).collect(),
            reply_to: m.reply_to as u64,
        }
    }
}

impl From<&MessageAttachment> for v1::Attachment {
    fn from(a: &MessageAttachment) -> Self {
        Self {
            id: a.id as u64,
            filename: a.filename.clone(),
            content_type: a.content_type.clone(),
            size: a.size as u64,
            blake3: a.blake3.clone(),
            expires_at: a.expires_at_ms as u64,
            preview_url: a.preview_url.clone(),
        }
    }
}

impl From<v1::Attachment> for MessageAttachment {
    fn from(a: v1::Attachment) -> Self {
        Self {
            id: a.id as i64,
            filename: a.filename,
            content_type: a.content_type,
            size: a.size as i64,
            blake3: a.blake3,
            expires_at_ms: a.expires_at as i64,
            preview_url: a.preview_url,
        }
    }
}
