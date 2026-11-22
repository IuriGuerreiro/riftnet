pub const CLAIM_DM_KEY: &str =
    "INSERT INTO dm_keys (dm_key, conversation_id) VALUES (?, ?) IF NOT EXISTS";

pub const GET_DM_KEY: &str = "SELECT conversation_id FROM dm_keys WHERE dm_key = ?";

pub const INSERT_CONVERSATION: &str = "INSERT INTO conversations (id, kind, name, members, last_seq, created_at) \
     VALUES (?, ?, ?, ?, 0, ?)";

pub const INSERT_BY_USER: &str =
    "INSERT INTO conversations_by_user (user_id, conversation_id) VALUES (?, ?)";

pub const GET_CONVERSATION: &str = "SELECT id, kind, last_seq, members, name, last_message_at, created_at \
     FROM conversations WHERE id = ?";

pub const DELETE_BY_USER: &str =
    "DELETE FROM conversations_by_user WHERE user_id = ? AND conversation_id = ?";

pub const SET_MEMBERS: &str = "UPDATE conversations SET members = ? WHERE id = ? IF members = ?";

pub const RENAME: &str = "UPDATE conversations SET name = ? WHERE id = ?";

pub const LIST_BY_USER: &str =
    "SELECT conversation_id FROM conversations_by_user WHERE user_id = ? LIMIT 200";

pub const BUMP_SEQ: &str = "UPDATE conversations SET last_seq = ? WHERE id = ? IF last_seq = ?";

pub const BUMP_MESSAGE_SEQ: &str =
    "UPDATE conversations SET last_seq = ?, last_message_at = ? WHERE id = ? IF last_seq = ?";

pub const CLAIM_GROUP_NONCE: &str = "INSERT INTO group_nonces (user_id, nonce, conversation_id) \
     VALUES (?, ?, ?) IF NOT EXISTS USING TTL 86400";

pub const GET_GROUP_NONCE: &str =
    "SELECT conversation_id FROM group_nonces WHERE user_id = ? AND nonce = ?";

pub const LIST_READ_STATES: &str =
    "SELECT conversation_id, last_read_seq FROM read_states WHERE user_id = ?";

pub const INSERT_READ_STATE: &str = "INSERT INTO read_states (user_id, conversation_id, last_read_seq) \
     VALUES (?, ?, ?) IF NOT EXISTS";

pub const ADVANCE_READ_STATE: &str = "UPDATE read_states SET last_read_seq = ? \
     WHERE user_id = ? AND conversation_id = ? IF last_read_seq < ?";
