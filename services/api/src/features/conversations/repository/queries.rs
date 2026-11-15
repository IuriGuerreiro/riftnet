pub const CLAIM_DM_KEY: &str =
    "INSERT INTO dm_keys (dm_key, conversation_id) VALUES (?, ?) IF NOT EXISTS";

pub const GET_DM_KEY: &str = "SELECT conversation_id FROM dm_keys WHERE dm_key = ?";

pub const INSERT_CONVERSATION: &str = "INSERT INTO conversations (id, kind, members, last_seq, created_at) \
     VALUES (?, ?, ?, 0, ?)";

pub const INSERT_BY_USER: &str =
    "INSERT INTO conversations_by_user (user_id, conversation_id) VALUES (?, ?)";

pub const GET_CONVERSATION: &str =
    "SELECT id, kind, last_seq, members FROM conversations WHERE id = ?";

pub const LIST_BY_USER: &str =
    "SELECT conversation_id FROM conversations_by_user WHERE user_id = ? LIMIT 200";

pub const BUMP_SEQ: &str = "UPDATE conversations SET last_seq = ? WHERE id = ? IF last_seq = ?";
