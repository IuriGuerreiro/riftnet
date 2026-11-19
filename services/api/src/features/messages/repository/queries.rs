pub const CLAIM_NONCE: &str = "INSERT INTO message_nonces (conversation_id, author_id, nonce, message_id) \
     VALUES (?, ?, ?, ?) IF NOT EXISTS USING TTL 86400";

pub const GET_NONCE: &str = "SELECT message_id FROM message_nonces \
     WHERE conversation_id = ? AND author_id = ? AND nonce = ?";

pub const INSERT_MESSAGE: &str = "INSERT INTO messages \
     (conversation_id, bucket, id, seq, author_id, content, encryption, attachments, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

pub const GET_MESSAGE: &str = "SELECT conversation_id, id, seq, author_id, content, encryption, edited_at, attachments, reply_to \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id = ?";

pub const HISTORY: &str = "SELECT conversation_id, id, seq, author_id, content, encryption, edited_at, attachments, reply_to \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id < ? LIMIT ?";

pub const EDIT_MESSAGE: &str = "UPDATE messages SET content = ?, edited_at = ? \
     WHERE conversation_id = ? AND bucket = ? AND id = ? IF EXISTS";

pub const DELETE_MESSAGE: &str =
    "DELETE FROM messages WHERE conversation_id = ? AND bucket = ? AND id = ?";

pub const INSERT_CHANGE: &str = "INSERT INTO message_changes (conversation_id, seq, message_id, kind) \
     VALUES (?, ?, ?, ?)";

pub const CHANGES_SINCE: &str = "SELECT seq, message_id, kind FROM message_changes \
     WHERE conversation_id = ? AND seq > ? LIMIT ?";

pub const MARK_DELETED: &str = "INSERT INTO deleted_messages (conversation_id, id) \
     VALUES (?, ?) USING TTL 86400";

pub const WAS_DELETED: &str =
    "SELECT id FROM deleted_messages WHERE conversation_id = ? AND id = ?";

pub const DELETE_REACTIONS: &str =
    "DELETE FROM message_reactions WHERE conversation_id = ? AND message_id = ?";

pub const ADD_REACTION: &str = "INSERT INTO message_reactions (conversation_id, message_id, emoji, user_id) \
     VALUES (?, ?, ?, ?) IF NOT EXISTS";

pub const REMOVE_REACTION: &str = "DELETE FROM message_reactions \
     WHERE conversation_id = ? AND message_id = ? AND emoji = ? AND user_id = ? IF EXISTS";

pub const REACTIONS_FOR: &str = "SELECT message_id, emoji, user_id FROM message_reactions \
     WHERE conversation_id = ? AND message_id IN ?";
