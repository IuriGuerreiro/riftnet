use async_trait::async_trait;
use sqlx::PgPool;

use super::models::PresencePreference;
use crate::common::error::RepoError;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SavedPreference {
    pub user_id: i64,
    pub preference: PresencePreference,
    pub version: i64,
}

#[async_trait]
pub trait PreferenceRepository: Send + Sync {
    async fn pending(&self) -> Result<Vec<SavedPreference>, RepoError>;
    async fn acknowledge(&self, user_id: i64, version: i64) -> Result<(), RepoError>;
    async fn get_many(&self, ids: &[i64]) -> Result<Vec<SavedPreference>, RepoError>;
    async fn set(
        &self,
        user_id: i64,
        preference: PresencePreference,
    ) -> Result<SavedPreference, RepoError>;
}

pub struct PgPreferenceRepository {
    pool: PgPool,
}

impl PgPreferenceRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreferenceRepository for PgPreferenceRepository {
    async fn pending(&self) -> Result<Vec<SavedPreference>, RepoError> {
        Ok(sqlx::query_as("SELECT u.id AS user_id, u.presence_preference AS preference, u.presence_version AS version FROM presence_preference_updates p JOIN users u ON u.id = p.user_id ORDER BY p.user_id LIMIT 100")
            .fetch_all(&self.pool).await?)
    }

    async fn acknowledge(&self, user_id: i64, version: i64) -> Result<(), RepoError> {
        sqlx::query("DELETE FROM presence_preference_updates WHERE user_id = $1 AND version <= $2")
            .bind(user_id)
            .bind(version)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_many(&self, ids: &[i64]) -> Result<Vec<SavedPreference>, RepoError> {
        Ok(sqlx::query_as("SELECT id AS user_id, presence_preference AS preference, presence_version AS version FROM users WHERE id = ANY($1)")
            .bind(ids).fetch_all(&self.pool).await?)
    }

    async fn set(
        &self,
        user_id: i64,
        preference: PresencePreference,
    ) -> Result<SavedPreference, RepoError> {
        Ok(sqlx::query_as("WITH saved AS (UPDATE users SET presence_preference = $2, presence_version = presence_version + 1 WHERE id = $1 RETURNING id AS user_id, presence_preference AS preference, presence_version AS version), queued AS (INSERT INTO presence_preference_updates (user_id, version) SELECT user_id, version FROM saved ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version) SELECT * FROM saved")
            .bind(user_id).bind(preference).fetch_one(&self.pool).await?)
    }
}
