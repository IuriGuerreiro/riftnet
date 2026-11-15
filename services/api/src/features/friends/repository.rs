use async_trait::async_trait;
use sqlx::PgPool;

use super::models::{Friendship, ordered_pair};
use crate::common::error::RepoError;

/// Data access for friendships. Takes the two user ids in any order:
/// the Postgres version sorts them (see `ordered_pair`).
#[async_trait]
pub trait FriendRepo: Send + Sync {
    async fn find(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError>;
    /// Every row I'm in: friends and requests both ways.
    async fn list_for_user(&self, user_id: i64) -> Result<Vec<Friendship>, RepoError>;
    async fn count_pending_outgoing(&self, user_id: i64) -> Result<i64, RepoError>;
    /// New pending request. `Err(Conflict)` if the pair already has a row.
    async fn create_request(&self, requester: i64, target: i64) -> Result<Friendship, RepoError>;
    /// Pending → accepted, only if `acceptor` is not the one who sent it.
    /// `None` if there was no such request.
    async fn accept(&self, acceptor: i64, requester: i64) -> Result<Option<Friendship>, RepoError>;
    /// Deletes the pair's row (decline, cancel, remove). Returns what was deleted.
    async fn delete(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError>;
}

pub struct PgFriendRepo {
    pool: PgPool,
}

impl PgFriendRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FriendRepo for PgFriendRepo {
    #[tracing::instrument(name = "db SELECT friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "friendships"))]
    async fn find(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError> {
        let (low, high) = ordered_pair(a, b);
        Ok(
            sqlx::query_as("SELECT * FROM friendships WHERE user_low = $1 AND user_high = $2")
                .bind(low)
                .bind(high)
                .fetch_optional(&self.pool)
                .await?,
        )
    }

    #[tracing::instrument(name = "db SELECT friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "friendships"))]
    async fn list_for_user(&self, user_id: i64) -> Result<Vec<Friendship>, RepoError> {
        // Two indexed lookups (primary key for user_low, the extra index for user_high).
        Ok(sqlx::query_as(
            "SELECT * FROM friendships WHERE user_low = $1 \
             UNION ALL \
             SELECT * FROM friendships WHERE user_high = $1 \
             ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db SELECT friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "friendships"))]
    async fn count_pending_outgoing(&self, user_id: i64) -> Result<i64, RepoError> {
        Ok(sqlx::query_scalar(
            "SELECT count(*) FROM friendships \
             WHERE (user_low = $1 OR user_high = $1) AND requester_id = $1 AND status = 'pending'",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db INSERT friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "friendships"))]
    async fn create_request(&self, requester: i64, target: i64) -> Result<Friendship, RepoError> {
        let (low, high) = ordered_pair(requester, target);
        Ok(sqlx::query_as(
            "INSERT INTO friendships (user_low, user_high, requester_id) \
             VALUES ($1, $2, $3) RETURNING *",
        )
        .bind(low)
        .bind(high)
        .bind(requester)
        .fetch_one(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db UPDATE friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "friendships"))]
    async fn accept(&self, acceptor: i64, requester: i64) -> Result<Option<Friendship>, RepoError> {
        let (low, high) = ordered_pair(acceptor, requester);
        // All conditions in the WHERE: two accepts at once can't both win.
        Ok(sqlx::query_as(
            "UPDATE friendships SET status = 'accepted', accepted_at = now() \
             WHERE user_low = $1 AND user_high = $2 AND status = 'pending' AND requester_id = $3 \
             RETURNING *",
        )
        .bind(low)
        .bind(high)
        .bind(requester)
        .fetch_optional(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db DELETE friendships", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "DELETE", db.collection.name = "friendships"))]
    async fn delete(&self, a: i64, b: i64) -> Result<Option<Friendship>, RepoError> {
        let (low, high) = ordered_pair(a, b);
        Ok(sqlx::query_as(
            "DELETE FROM friendships WHERE user_low = $1 AND user_high = $2 RETURNING *",
        )
        .bind(low)
        .bind(high)
        .fetch_optional(&self.pool)
        .await?)
    }
}
