use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct BotResponse {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct KeyResponse {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct IssuedKeyResponse {
    pub key: KeyResponse,
    pub token: String,
}

#[derive(Deserialize)]
pub struct NameInput {
    pub name: String,
}

impl From<super::models::Bot> for BotResponse {
    fn from(bot: super::models::Bot) -> Self {
        Self {
            id: bot.id.to_string(),
            name: bot.name,
            created_at: bot.created_at,
        }
    }
}

impl From<super::models::KeyMetadata> for KeyResponse {
    fn from(key: super::models::KeyMetadata) -> Self {
        Self {
            id: key.id.to_string(),
            name: key.name,
            created_at: key.created_at,
            revoked_at: key.revoked_at,
        }
    }
}

impl From<super::service::IssuedKey> for IssuedKeyResponse {
    fn from(issued: super::service::IssuedKey) -> Self {
        Self {
            key: issued.key.into(),
            token: issued.token,
        }
    }
}
