use chrono::{DateTime, Utc};

// Some fields are only read by later features.
#[allow(dead_code)]
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub zitadel_id: String,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub created_at: DateTime<Utc>,
}
