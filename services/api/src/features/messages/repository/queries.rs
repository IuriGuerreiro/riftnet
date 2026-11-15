//! CQL for messages. Tables: `services/api/scylla/002_messages.cql`.

/// Remember a client nonce for a day. LWT: only the first send with this
/// nonce wins; a retry finds the row and gets the same message back.
pub const CLAIM_NONCE: &str = "INSERT INTO message_nonces (conversation_id, author_id, nonce, message_id) \
     VALUES (?, ?, ?, ?) IF NOT EXISTS USING TTL 86400";

pub const GET_NONCE: &str = "SELECT message_id FROM message_nonces \
     WHERE conversation_id = ? AND author_id = ? AND nonce = ?";

pub const INSERT_MESSAGE: &str = "INSERT INTO messages \
     (conversation_id, bucket, id, seq, author_id, content, encryption) VALUES (?, ?, ?, ?, ?, ?, ?)";

/// Columns: conversation_id, id, seq, author_id, content, encryption, edited_at (see `Row`).
pub const GET_MESSAGE: &str = "SELECT conversation_id, id, seq, author_id, content, encryption, edited_at \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id = ?";

/// Newest first (the table's order), older than `id`, in one bucket.
pub const HISTORY: &str = "SELECT conversation_id, id, seq, author_id, content, encryption, edited_at \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id < ? LIMIT ?";

/// LWT: only if the row still exists. A plain UPDATE on a deleted message
/// would bring back a half-empty row (in Scylla, UPDATE = upsert).
pub const EDIT_MESSAGE: &str = "UPDATE messages SET content = ?, edited_at = ? \
     WHERE conversation_id = ? AND bucket = ? AND id = ? IF EXISTS";

pub const DELETE_MESSAGE: &str =
    "DELETE FROM messages WHERE conversation_id = ? AND bucket = ? AND id = ?";

pub const INSERT_CHANGE: &str = "INSERT INTO message_changes (conversation_id, seq, message_id, kind) \
     VALUES (?, ?, ?, ?)";

/// Oldest first (the table's order).
pub const CHANGES_SINCE: &str = "SELECT seq, message_id, kind FROM message_changes \
     WHERE conversation_id = ? AND seq > ? LIMIT ?";
