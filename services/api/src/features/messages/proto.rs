//! Our message model → the protobuf `Message` sent over the WebSocket.

use protocol::v1;

use super::models::Message;

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
        }
    }
}
