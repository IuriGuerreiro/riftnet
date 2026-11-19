use chrono::{DateTime, Utc};

#[allow(dead_code)]
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub zitadel_id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    /// BLAKE3 of the 512px avatar, 32 bytes. None = no avatar.
    pub avatar_hash: Option<Vec<u8>>,
    pub created_at: DateTime<Utc>,
}

impl User {
    pub fn avatar_hex(&self) -> Option<String> {
        self.avatar_hash.as_deref().map(hex)
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
