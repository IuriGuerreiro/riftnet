use async_trait::async_trait;
use sqlx::PgPool;

use super::models::User;
use crate::common::error::RepoError;

#[async_trait]
pub trait UserRepo: Send + Sync {
    async fn find_by_id(&self, id: i64) -> Result<Option<User>, RepoError>;
    async fn find_by_zitadel_id(&self, zitadel_id: &str) -> Result<Option<User>, RepoError>;
    async fn find_by_ids(&self, ids: &[i64]) -> Result<Vec<User>, RepoError>;
    // INVARIANT: `username` must already be lowercase.
    async fn find_by_username(&self, username: &str) -> Result<Option<User>, RepoError>;
    async fn search_by_username_prefix(
        &self,
        prefix: &str,
        upper_bound: &str,
        exclude_id: i64,
        limit: i64,
    ) -> Result<Vec<User>, RepoError>;
    async fn create(&self, id: i64, zitadel_id: &str) -> Result<User, RepoError>;
    async fn set_username(&self, id: i64, username: &str) -> Result<Option<User>, RepoError>;
    /// Writes both fields as given (None clears). None if the user is gone.
    /// Outer None = leave the field alone; Some(None) = clear it.
    /// One statement, so two partial updates never undo each other.
    async fn set_profile(
        &self,
        id: i64,
        display_name: Option<Option<&str>>,
        bio: Option<Option<&str>>,
        custom_status: Option<Option<&str>>,
    ) -> Result<Option<User>, RepoError>;
    /// Swaps the avatar hash. Returns the user and the hash it replaced,
    /// so the caller can delete the old files. None if the user is gone.
    async fn set_avatar(
        &self,
        id: i64,
        hash: Option<&[u8]>,
    ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError>;
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

    #[tracing::instrument(name = "db UPDATE users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "users"))]
    async fn set_profile(
        &self,
        id: i64,
        display_name: Option<Option<&str>>,
        bio: Option<Option<&str>>,
        custom_status: Option<Option<&str>>,
    ) -> Result<Option<User>, RepoError> {
        Ok(sqlx::query_as(
            "UPDATE users SET \
               display_name = CASE WHEN $2 THEN $3 ELSE display_name END, \
               bio = CASE WHEN $4 THEN $5 ELSE bio END, \
               custom_status = CASE WHEN $6 THEN $7 ELSE custom_status END \
             WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .bind(display_name.is_some())
        .bind(display_name.flatten())
        .bind(bio.is_some())
        .bind(bio.flatten())
        .bind(custom_status.is_some())
        .bind(custom_status.flatten())
        .fetch_optional(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db UPDATE users", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "users"))]
    async fn set_avatar(
        &self,
        id: i64,
        hash: Option<&[u8]>,
    ) -> Result<Option<(User, Option<Vec<u8>>)>, RepoError> {
        let mut tx = self.pool.begin().await?;
        // Row lock: two uploads at once each see the hash they really replaced.
        let old: Option<(Option<Vec<u8>>,)> =
            sqlx::query_as("SELECT avatar_hash FROM users WHERE id = $1 FOR UPDATE")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some((old,)) = old else {
            return Ok(None);
        };
        let user: User =
            sqlx::query_as("UPDATE users SET avatar_hash = $2 WHERE id = $1 RETURNING *")
                .bind(id)
                .bind(hash)
                .fetch_one(&mut *tx)
                .await?;
        tx.commit().await?;
        Ok(Some((user, old)))
    }
}
