use chrono::{DateTime, Utc};

/// A refresh token row joined with its device.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RefreshTokenRecord {
    pub id: i64,
    pub device_id: i64,
    pub user_id: i64,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    pub device_revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct NewDevice {
    pub name: String,
    pub platform: String,
}
