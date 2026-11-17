use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use super::models::{NewDevice, RefreshTokenRecord};
use crate::common::error::RepoError;

#[async_trait]
pub trait AuthRepo: Send + Sync {
    async fn create_device(
        &self,
        id: i64,
        user_id: i64,
        device: &NewDevice,
    ) -> Result<(), RepoError>;
    async fn insert_refresh_token(
        &self,
        id: i64,
        device_id: i64,
        hash: &[u8],
        expires_at: DateTime<Utc>,
    ) -> Result<(), RepoError>;
    async fn find_refresh_token(
        &self,
        hash: &[u8],
    ) -> Result<Option<RefreshTokenRecord>, RepoError>;
    async fn rotate_refresh_token(
        &self,
        old_id: i64,
        new_id: i64,
        device_id: i64,
        new_hash: &[u8],
        expires_at: DateTime<Utc>,
    ) -> Result<bool, RepoError>;
    async fn revoke_device(&self, device_id: i64) -> Result<(), RepoError>;
}

pub struct PgAuthRepo {
    pool: PgPool,
}

impl PgAuthRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuthRepo for PgAuthRepo {
    #[tracing::instrument(name = "db INSERT devices", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "devices"))]
    async fn create_device(
        &self,
        id: i64,
        user_id: i64,
        device: &NewDevice,
    ) -> Result<(), RepoError> {
        sqlx::query("INSERT INTO devices (id, user_id, name, platform) VALUES ($1, $2, $3, $4)")
            .bind(id)
            .bind(user_id)
            .bind(&device.name)
            .bind(&device.platform)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[tracing::instrument(name = "db INSERT refresh_tokens", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "refresh_tokens"))]
    async fn insert_refresh_token(
        &self,
        id: i64,
        device_id: i64,
        hash: &[u8],
        expires_at: DateTime<Utc>,
    ) -> Result<(), RepoError> {
        sqlx::query(
            "INSERT INTO refresh_tokens (id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(id)
        .bind(device_id)
        .bind(hash)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "db SELECT refresh_tokens", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "refresh_tokens"))]
    async fn find_refresh_token(
        &self,
        hash: &[u8],
    ) -> Result<Option<RefreshTokenRecord>, RepoError> {
        Ok(sqlx::query_as(
            "SELECT rt.id, rt.device_id, d.user_id, rt.expires_at, rt.used_at,
                    d.revoked_at AS device_revoked_at
             FROM refresh_tokens rt JOIN devices d ON d.id = rt.device_id
             WHERE rt.token_hash = $1",
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db UPDATE refresh_tokens", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "refresh_tokens"))]
    async fn rotate_refresh_token(
        &self,
        old_id: i64,
        new_id: i64,
        device_id: i64,
        new_hash: &[u8],
        expires_at: DateTime<Utc>,
    ) -> Result<bool, RepoError> {
        let mut tx = self.pool.begin().await?;
        let used = sqlx::query(
            "UPDATE refresh_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL",
        )
        .bind(old_id)
        .execute(&mut *tx)
        .await?;
        if used.rows_affected() == 0 {
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO refresh_tokens (id, device_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
        )
        .bind(new_id)
        .bind(device_id)
        .bind(new_hash)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE devices SET last_seen_at = now() WHERE id = $1")
            .bind(device_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(true)
    }

    #[tracing::instrument(name = "db UPDATE devices", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "devices"))]
    async fn revoke_device(&self, device_id: i64) -> Result<(), RepoError> {
        sqlx::query("UPDATE devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL")
            .bind(device_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
