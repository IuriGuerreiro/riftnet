//! Our models → protobuf types sent over the WebSocket.

use protocol::v1;

use super::models::{Conversation, Kind};

impl From<&Conversation> for v1::Conversation {
    fn from(c: &Conversation) -> Self {
        Self {
            id: c.id as u64,
            kind: match c.kind {
                Kind::Dm => v1::ConversationKind::Dm,
                Kind::Group => v1::ConversationKind::Group,
            } as i32,
            members: c.members.iter().map(v1::User::from).collect(),
            last_seq: c.last_seq as u64,
            name: c.name.clone(),
        }
    }
}
