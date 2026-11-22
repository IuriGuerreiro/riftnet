use async_trait::async_trait;
use sqlx::PgPool;

use super::models::{Bot, KeyMetadata};
use crate::common::error::RepoError;

#[async_trait]
pub trait BotRepo: Send + Sync {
    async fn create(&self, owner: i64, name: &str, id: i64) -> Result<Bot, RepoError>;
    async fn list(&self, owner: i64) -> Result<Vec<Bot>, RepoError>;
    async fn insert_key(
        &self,
        owner: i64,
        bot_id: i64,
        name: &str,
        id: i64,
        hash: &[u8],
    ) -> Result<Option<KeyMetadata>, RepoError>;
    async fn list_keys(
        &self,
        owner: i64,
        bot_id: i64,
    ) -> Result<Option<Vec<KeyMetadata>>, RepoError>;
    async fn revoke_key(&self, owner: i64, bot_id: i64, key_id: i64) -> Result<bool, RepoError>;
    async fn find_by_token_hash(&self, hash: &[u8]) -> Result<Option<Bot>, RepoError>;
}

pub struct PgBotRepo {
    pool: PgPool,
}

impl PgBotRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl BotRepo for PgBotRepo {
    #[tracing::instrument(name = "db INSERT bots", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "bots"))]
    async fn create(&self, owner: i64, name: &str, id: i64) -> Result<Bot, RepoError> {
        Ok(sqlx::query_as(
            "INSERT INTO bots (id, owner_user_id, name) VALUES ($1, $2, $3)
             RETURNING id, name, created_at",
        )
        .bind(id)
        .bind(owner)
        .bind(name)
        .fetch_one(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db SELECT bots", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "bots"))]
    async fn list(&self, owner: i64) -> Result<Vec<Bot>, RepoError> {
        Ok(sqlx::query_as(
            "SELECT id, name, created_at FROM bots WHERE owner_user_id = $1
             ORDER BY bots.id",
        )
        .bind(owner)
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db INSERT bot_api_keys", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "bot_api_keys"))]
    async fn insert_key(
        &self,
        owner: i64,
        bot_id: i64,
        name: &str,
        id: i64,
        hash: &[u8],
    ) -> Result<Option<KeyMetadata>, RepoError> {
        let key = sqlx::query_as(
            "INSERT INTO bot_api_keys (id, bot_id, name, token_hash)
             SELECT $1, id, $4, $5 FROM bots WHERE id = $2 AND owner_user_id = $3
             RETURNING id, name, created_at, revoked_at",
        )
        .bind(id)
        .bind(bot_id)
        .bind(owner)
        .bind(name)
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?;
        Ok(key)
    }

    #[tracing::instrument(name = "db SELECT bot_api_keys", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "bot_api_keys"))]
    async fn list_keys(
        &self,
        owner: i64,
        bot_id: i64,
    ) -> Result<Option<Vec<KeyMetadata>>, RepoError> {
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT FROM bots WHERE id = $1 AND owner_user_id = $2)",
        )
        .bind(bot_id)
        .bind(owner)
        .fetch_one(&self.pool)
        .await?;
        if !owned {
            return Ok(None);
        }

        Ok(Some(
            sqlx::query_as(
                "SELECT k.id, k.name, k.created_at, k.revoked_at
             FROM bot_api_keys k JOIN bots b ON b.id = k.bot_id
             WHERE b.id = $1 AND b.owner_user_id = $2 ORDER BY k.id",
            )
            .bind(bot_id)
            .bind(owner)
            .fetch_all(&self.pool)
            .await?,
        ))
    }

    #[tracing::instrument(name = "db UPDATE bot_api_keys", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "bot_api_keys"))]
    async fn revoke_key(&self, owner: i64, bot_id: i64, key_id: i64) -> Result<bool, RepoError> {
        let result = sqlx::query(
            "UPDATE bot_api_keys k SET revoked_at = COALESCE(k.revoked_at, now())
             FROM bots b WHERE b.id = k.bot_id AND b.id = $1 AND k.id = $2 AND b.owner_user_id = $3",
        )
        .bind(bot_id)
        .bind(key_id)
        .bind(owner)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() != 0)
    }

    #[tracing::instrument(name = "db SELECT bot_api_keys", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "bot_api_keys"))]
    async fn find_by_token_hash(&self, hash: &[u8]) -> Result<Option<Bot>, RepoError> {
        Ok(sqlx::query_as(
            "SELECT b.id, b.name, b.created_at
             FROM bot_api_keys k JOIN bots b ON b.id = k.bot_id
             WHERE k.token_hash = $1 AND k.revoked_at IS NULL",
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await?)
    }
}
