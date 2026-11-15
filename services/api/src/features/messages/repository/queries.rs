pub const CLAIM_NONCE: &str = "INSERT INTO message_nonces (conversation_id, author_id, nonce, message_id) \
     VALUES (?, ?, ?, ?) IF NOT EXISTS USING TTL 86400";

pub const GET_NONCE: &str = "SELECT message_id FROM message_nonces \
     WHERE conversation_id = ? AND author_id = ? AND nonce = ?";

pub const INSERT_MESSAGE: &str = "INSERT INTO messages \
     (conversation_id, bucket, id, seq, author_id, content, encryption) VALUES (?, ?, ?, ?, ?, ?, ?)";

pub const GET_MESSAGE: &str = "SELECT conversation_id, id, seq, author_id, content, encryption \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id = ?";

pub const HISTORY: &str = "SELECT conversation_id, id, seq, author_id, content, encryption \
     FROM messages WHERE conversation_id = ? AND bucket = ? AND id < ? LIMIT ?";
