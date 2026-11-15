use async_trait::async_trait;
use sqlx::PgPool;

use super::models::User;
use crate::common::error::RepoError;

/// Data access for users. Services depend on this trait, so a cache
/// (`CachedUserRepo`) or an in-memory fake can wrap or replace `PgUserRepo`.
#[async_trait]
pub trait UserRepo: Send + Sync {
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError>;
    async fn find_by_zitadel_id(&self, zitadel_id: &str) -> Result<Option<User>, RepoError>;
    async fn find_by_ids(&self, ids: &[i64]) -> Result<Vec<User>, RepoError>;
    /// `username` must already be normalized (lowercase).
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, RepoError>;
    /// Users with `prefix <= username < upper_bound` (byte order), sorted by
    /// username, skipping `exclude_id`. Both bounds already lowercase.
    async fn search_by_username_prefix(
        &self,
        prefix: &str,
        upper_bound: &str,
        exclude_id: i64,
        limit: i64,
    ) -> Result<Vec<User>, RepoError>;
    async fn create(&self, id: i64, zitadel_id: &str) -> Result<User, RepoError>;
    /// `Err(Conflict)` if the username is taken.
    async fn set_username(&self, id: i64, username: &str) -> Result<Option<User>, RepoError>;
}

pub struct PgUserRepo {
    pool: PgPool,
}

impl PgUserRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl UserRepo for PgUserRepo {
    #[tracing::instrument(name = "db SELECT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "users"))]
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    #[tracing::instrument(name = "db SELECT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "users"))]
    async fn find_by_zitadel_id(&self, zitadel_id: &str) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE zitadel_id = $1")
            .bind(zitadel_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    #[tracing::instrument(name = "db SELECT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "users"))]
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?)
    }

    #[tracing::instrument(name = "db SELECT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "users"))]
    async fn find_by_ids(&self, ids: &[i64]) -> Result<Vec<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&self.pool)
            .await?)
    }

    #[tracing::instrument(name = "db SELECT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "users"))]
    async fn search_by_username_prefix(
        &self,
        prefix: &str,
        upper_bound: &str,
        exclude_id: i64,
        limit: i64,
    ) -> Result<Vec<User>, RepoError> {
        // A range, not `LIKE $1 || '%'`: Postgres can't use the index for a
        // LIKE pattern that is a parameter once it caches a generic plan.
        // `~>=~` / `~<~` are the byte-order operators `text_pattern_ops` indexes.
        Ok(sqlx::query_as(
            "SELECT * FROM users \
             WHERE username ~>=~ $1 AND username ~<~ $2 AND id <> $3 \
             ORDER BY username USING ~<~ \
             LIMIT $4",
        )
        .bind(prefix)
        .bind(upper_bound)
        .bind(exclude_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db INSERT users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "users"))]
    async fn create(&self, id: i64, zitadel_id: &str) -> Result<User, RepoError> {
        Ok(
            sqlx::query_as("INSERT INTO users (id, zitadel_id) VALUES ($1, $2) RETURNING *")
                .bind(id)
                .bind(zitadel_id)
                .fetch_one(&self.pool)
                .await?,
        )
    }

    #[tracing::instrument(name = "db UPDATE users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "users"))]
    async fn set_username(&self, id: i64, username: &str) -> Result<Option<User>, RepoError> {
        Ok(
            sqlx::query_as("UPDATE users SET username = $2 WHERE id = $1 RETURNING *")
                .bind(id)
                .bind(username)
                .fetch_optional(&self.pool)
                .await?,
        )
    }
}
