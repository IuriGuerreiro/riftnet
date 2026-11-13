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
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn find_by_zitadel_id(&self, zitadel_id: &str) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM users WHERE zitadel_id = $1")
            .bind(zitadel_id)
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn create(&self, id: i64, zitadel_id: &str) -> Result<User, RepoError> {
        Ok(
            sqlx::query_as("INSERT INTO users (id, zitadel_id) VALUES ($1, $2) RETURNING *")
                .bind(id)
                .bind(zitadel_id)
                .fetch_one(&self.pool)
                .await?,
        )
    }

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
