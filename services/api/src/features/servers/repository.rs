use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::PgPool;

use super::models::{Server, ServerMembership};
use crate::common::error::RepoError;

#[async_trait]
pub trait ServerRepo: Send + Sync {
    async fn member_ids(&self, server_id: i64) -> Result<Vec<i64>, RepoError>;
    async fn author_names(&self, ids: &[i64]) -> Result<HashMap<i64, String>, RepoError>;
    async fn member_server(&self, user_id: i64, channel_id: i64) -> Result<Option<i64>, RepoError>;
    async fn create(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<(), RepoError>;
    async fn list(&self, user_id: i64) -> Result<Vec<ServerMembership>, RepoError>;
    async fn list_channels(
        &self,
        user_id: i64,
        server_id: i64,
    ) -> Result<Option<Vec<Server>>, RepoError>;
    async fn invite(
        &self,
        user_id: i64,
        server_id: i64,
        candidate: &str,
    ) -> Result<Option<String>, RepoError>;
    async fn revoke_invite(&self, user_id: i64, server_id: i64) -> Result<bool, RepoError>;
    async fn join(&self, user_id: i64, token: &str) -> Result<Option<Server>, RepoError>;
}

pub struct PgServerRepo {
    pool: PgPool,
}

impl PgServerRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ServerRepo for PgServerRepo {
    async fn create(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<(), RepoError> {
        let mut transaction = self.pool.begin().await.map_err(RepoError::from)?;
        sqlx::query("INSERT INTO servers (id, name) VALUES ($1, $2)")
            .bind(server_id)
            .bind(name)
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        sqlx::query(
            "INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(RepoError::from)?;
        sqlx::query("INSERT INTO server_channels (id, server_id, name) VALUES ($1, $2, $3)")
            .bind(channel_id)
            .bind(server_id)
            .bind("general")
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        transaction.commit().await.map_err(RepoError::from)?;

        Ok(())
    }

    async fn list(&self, user_id: i64) -> Result<Vec<ServerMembership>, RepoError> {
        let servers = sqlx::query_as::<_, (i64, String, bool)>(
            "SELECT s.id, s.name, m.role = 'owner'
             FROM server_members m JOIN servers s ON s.id = m.server_id
             WHERE m.user_id = $1 ORDER BY s.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(servers
            .into_iter()
            .map(|(id, name, is_owner)| ServerMembership {
                server: Server { id, name },
                is_owner,
            })
            .collect())
    }

    async fn list_channels(
        &self,
        user_id: i64,
        server_id: i64,
    ) -> Result<Option<Vec<Server>>, RepoError> {
        let rows = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
            "SELECT c.id, c.name
             FROM server_members m LEFT JOIN server_channels c ON c.server_id = m.server_id
             WHERE m.user_id = $1 AND m.server_id = $2 ORDER BY c.id",
        )
        .bind(user_id)
        .bind(server_id)
        .fetch_all(&self.pool)
        .await
        .map_err(RepoError::from)?;
        if rows.is_empty() {
            return Ok(None);
        }
        Ok(Some(
            rows.into_iter()
                .filter_map(|(id, name)| {
                    Some(Server {
                        id: id?,
                        name: name?,
                    })
                })
                .collect(),
        ))
    }

    async fn invite(
        &self,
        user_id: i64,
        server_id: i64,
        candidate: &str,
    ) -> Result<Option<String>, RepoError> {
        let token = sqlx::query_scalar(
            "INSERT INTO server_invites (server_id, token)
             SELECT server_id, $3 FROM server_members
             WHERE server_id = $1 AND user_id = $2 AND role = 'owner'
             FOR SHARE
             ON CONFLICT (server_id) DO UPDATE SET token = server_invites.token
             RETURNING token",
        )
        .bind(server_id)
        .bind(user_id)
        .bind(candidate)
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?;
        Ok(token)
    }

    async fn revoke_invite(&self, user_id: i64, server_id: i64) -> Result<bool, RepoError> {
        let owner: Option<i64> = sqlx::query_scalar(
            "WITH owner AS (
                 SELECT server_id FROM server_members
                 WHERE server_id = $1 AND user_id = $2 AND role = 'owner'
                 FOR SHARE
             ), revoked AS (
                 DELETE FROM server_invites WHERE server_id IN (SELECT server_id FROM owner)
             )
             SELECT server_id FROM owner",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?;
        Ok(owner.is_some())
    }

    async fn join(&self, user_id: i64, token: &str) -> Result<Option<Server>, RepoError> {
        let server = sqlx::query_as::<_, (i64, String)>(
            "WITH invited AS (
                 SELECT s.id, s.name FROM server_invites i JOIN servers s ON s.id = i.server_id
                 WHERE i.token = $1 FOR KEY SHARE OF i
             ), joined AS (
                 INSERT INTO server_members (server_id, user_id, role)
                 SELECT id, $2, 'member' FROM invited
                 ON CONFLICT (server_id, user_id) DO NOTHING
             )
             SELECT id, name FROM invited",
        )
        .bind(token)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?;
        Ok(server.map(|(id, name)| Server { id, name }))
    }
    async fn member_server(&self, user_id: i64, channel_id: i64) -> Result<Option<i64>, RepoError> {
        Ok(sqlx::query_scalar(
            "SELECT c.server_id FROM server_channels c
             JOIN server_members m ON m.server_id = c.server_id
             WHERE c.id = $1 AND m.user_id = $2",
        )
        .bind(channel_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?)
    }
    async fn author_names(&self, ids: &[i64]) -> Result<HashMap<i64, String>, RepoError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let names = sqlx::query_as(
            "SELECT id, COALESCE(display_name, username, 'Unknown user') FROM users WHERE id = ANY($1)",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(names.into_iter().collect())
    }
    async fn member_ids(&self, server_id: i64) -> Result<Vec<i64>, RepoError> {
        Ok(
            sqlx::query_scalar("SELECT user_id FROM server_members WHERE server_id = $1")
                .bind(server_id)
                .fetch_all(&self.pool)
                .await?,
        )
    }
}
