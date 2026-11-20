use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::PgPool;

use super::models::{ChannelWrite, LeaveOutcome, Server, ServerMember, ServerMembership};
use crate::common::error::RepoError;

#[async_trait]
pub trait ServerRepo: Send + Sync {
    async fn remove_member(
        &self,
        owner_id: i64,
        server_id: i64,
        user_id: i64,
    ) -> Result<bool, RepoError>;
    async fn leave(&self, user_id: i64, server_id: i64) -> Result<LeaveOutcome, RepoError>;

    async fn create_channel(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<ChannelWrite, RepoError>;
    async fn rename_channel(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<Option<Server>, RepoError>;
    async fn list_members(
        &self,
        user_id: i64,
        server_id: i64,
        after_id: i64,
    ) -> Result<Option<Vec<ServerMember>>, RepoError>;

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
    async fn remove_member(
        &self,
        owner_id: i64,
        server_id: i64,
        user_id: i64,
    ) -> Result<bool, RepoError> {
        let owner: Option<i64> = sqlx::query_scalar(
            "WITH owner AS (
                SELECT server_id FROM server_members
                WHERE server_id = $1 AND user_id = $2 AND role = 'owner' FOR SHARE
             ), removed AS (
                DELETE FROM server_members
                WHERE server_id IN (SELECT server_id FROM owner) AND user_id = $3 AND role = 'member'
             )
             SELECT server_id FROM owner",
        )
        .bind(server_id)
        .bind(owner_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(owner.is_some())
    }

    async fn leave(&self, user_id: i64, server_id: i64) -> Result<LeaveOutcome, RepoError> {
        let role: Option<String> = sqlx::query_scalar(
            "WITH membership AS (
                SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2 FOR UPDATE
             ), removed AS (
                DELETE FROM server_members WHERE server_id = $1 AND user_id = $2
                AND role = 'member' AND EXISTS (SELECT 1 FROM membership)
             )
             SELECT role FROM membership",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(match role.as_deref() {
            Some("member") => LeaveOutcome::Left,
            Some(_) => LeaveOutcome::Owner,
            None => LeaveOutcome::NotFound,
        })
    }

    async fn create_channel(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<ChannelWrite, RepoError> {
        let mut tx = self.pool.begin().await?;
        let owner: Option<i64> = sqlx::query_scalar(
            "SELECT s.id FROM servers s JOIN server_members m ON m.server_id = s.id
             WHERE s.id = $1 AND m.user_id = $2 AND m.role = 'owner'
             FOR UPDATE OF s FOR SHARE OF m",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;
        if owner.is_none() {
            return Ok(ChannelWrite::NotFound);
        }
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM server_channels WHERE server_id = $1")
                .bind(server_id)
                .fetch_one(&mut *tx)
                .await?;
        if count >= 100 {
            return Ok(ChannelWrite::LimitReached);
        }
        sqlx::query("INSERT INTO server_channels (id, server_id, name) VALUES ($1, $2, $3)")
            .bind(channel_id)
            .bind(server_id)
            .bind(name)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(ChannelWrite::Saved(Server {
            id: channel_id,
            name: name.into(),
        }))
    }

    async fn rename_channel(
        &self,
        user_id: i64,
        server_id: i64,
        channel_id: i64,
        name: &str,
    ) -> Result<Option<Server>, RepoError> {
        let row: Option<(i64, String)> = sqlx::query_as(
            "WITH owner AS (
                SELECT server_id FROM server_members WHERE server_id = $1 AND user_id = $2 AND role = 'owner' FOR SHARE
             ) UPDATE server_channels SET name = $4
             WHERE id = $3 AND server_id IN (SELECT server_id FROM owner) RETURNING id, name",
        ).bind(server_id).bind(user_id).bind(channel_id).bind(name).fetch_optional(&self.pool).await?;
        Ok(row.map(|(id, name)| Server { id, name }))
    }

    async fn list_members(
        &self,
        user_id: i64,
        server_id: i64,
        after_id: i64,
    ) -> Result<Option<Vec<ServerMember>>, RepoError> {
        let mut tx = self.pool.begin().await?;
        let member: Option<i64> = sqlx::query_scalar(
            "SELECT user_id FROM server_members WHERE server_id = $1 AND user_id = $2 FOR SHARE",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;
        if member.is_none() {
            return Ok(None);
        }
        let rows = sqlx::query_as(
            "SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.username, 'Unknown user') AS name,
             m.role = 'owner' AS is_owner
             FROM server_members m JOIN users u ON u.id = m.user_id
             WHERE m.server_id = $1 AND m.user_id > $2 ORDER BY m.user_id LIMIT 101",
        )
        .bind(server_id)
        .bind(after_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Some(rows))
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::servers::service::ServerService;
    use common::snowflake::Snowflake;
    use std::sync::Arc;

    struct NoEvents;
    #[async_trait]
    impl crate::common::events::EventBus for NoEvents {
        async fn publish_to_users(&self, _: &[i64], _: bytes::Bytes) -> anyhow::Result<()> {
            Ok(())
        }
        async fn subscribe_user(
            &self,
            _: i64,
        ) -> anyhow::Result<futures::stream::BoxStream<'static, bytes::Bytes>> {
            Ok(Box::pin(futures::stream::empty()))
        }
    }

    #[tokio::test]
    #[ignore = "requires local Postgres"]
    async fn channel_management_and_member_visibility() {
        let admin_url = std::env::var("IT_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://app:app@127.0.0.1:55432/app".into());
        let admin = PgPool::connect(&admin_url).await.unwrap();
        let database = format!("server_management_{}", rand::random::<u32>());
        sqlx::query(&format!("CREATE DATABASE {database}"))
            .execute(&admin)
            .await
            .unwrap();
        let base = admin_url.rsplit_once('/').unwrap().0;
        let pool = PgPool::connect(&format!("{base}/{database}"))
            .await
            .unwrap();
        let result = verify_channel_management(pool.clone()).await;
        pool.close().await;
        sqlx::query(&format!("DROP DATABASE {database}"))
            .execute(&admin)
            .await
            .unwrap();
        admin.close().await;
        result.unwrap();
    }

    async fn verify_channel_management(pool: PgPool) -> anyhow::Result<()> {
        sqlx::migrate!("./migrations").run(&pool).await?;
        sqlx::query("INSERT INTO users (id, zitadel_id, username) VALUES (1, 'owner', 'owner'), (2, 'member', 'member'), (3, 'outsider', 'outsider')")
            .execute(&pool).await?;
        let repo = Arc::new(PgServerRepo::new(pool.clone()));
        repo.create(1, 10, 11, "First").await?;
        repo.create(3, 20, 21, "Other").await?;
        sqlx::query("INSERT INTO server_members VALUES (10, 2, 'member')")
            .execute(&pool)
            .await?;
        let service = ServerService::new(
            repo.clone(),
            Arc::new(Snowflake::new(999)),
            Arc::new(NoEvents),
        );
        let channel = service.create_channel(1, 10, "  planning  ").await?;
        assert_eq!(channel.name, "planning");
        assert!(matches!(
            service.create_channel(2, 10, "denied").await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        assert!(matches!(
            service.rename_channel(2, 10, channel.id, "denied").await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        assert!(matches!(
            service.rename_channel(1, 10, 21, "cross-server").await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        let renamed = service.rename_channel(1, 10, channel.id, "roadmap").await?;
        assert_eq!(renamed.name, "roadmap");
        assert!(matches!(
            service.create_channel(1, 10, "roadmap").await,
            Err(crate::common::error::ApiError::Conflict {
                code: "channel_name_taken",
                ..
            })
        ));
        for name in ["".into(), " ".into(), "a".repeat(101), "bad\0name".into()] {
            assert!(service.create_channel(1, 10, &name).await.is_err());
        }
        assert!(
            service
                .create_channel(1, 10, &"é".repeat(100))
                .await
                .is_ok()
        );
        let members = service.list_members(2, 10, 0).await?;
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].name, "owner");
        assert!(members[0].is_owner);
        assert!(!members[1].is_owner);
        assert_eq!(service.list_members(2, 10, 1).await?[0].id, 2);
        assert!(matches!(
            service.list_members(3, 10, 0).await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        sqlx::query("INSERT INTO server_channels (id, server_id, name) SELECT 1000 + n, 10, 'channel-' || n FROM generate_series(1, 96) n")
            .execute(&pool).await?;
        let (first, second) = tokio::join!(
            service.create_channel(1, 10, "last-one"),
            service.create_channel(1, 10, "last-two")
        );
        assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM server_channels WHERE server_id = 10")
                .fetch_one(&pool)
                .await?;
        assert_eq!(count, 100);
        assert!(matches!(
            service.remove_member(2, 10, 1).await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        assert!(matches!(
            service.remove_member(3, 10, 2).await,
            Err(crate::common::error::ApiError::NotFound)
        ));
        assert!(matches!(
            service.remove_member(1, 10, 1).await,
            Err(crate::common::error::ApiError::Conflict {
                code: "owner_cannot_leave",
                ..
            })
        ));
        assert!(matches!(
            service.leave(1, 10).await,
            Err(crate::common::error::ApiError::Conflict {
                code: "owner_cannot_leave",
                ..
            })
        ));
        service.remove_member(1, 10, 2).await?;
        service.remove_member(1, 10, 2).await?;
        assert!(repo.member_server(2, 11).await?.is_none());
        assert!(repo.list_channels(2, 10).await?.is_none());
        assert!(repo.list_members(2, 10, 0).await?.is_none());
        let invite = service.invite(1, 10).await?;
        service.join(2, &invite).await?;
        assert!(repo.member_server(2, 11).await?.is_some());
        service.leave(2, 10).await?;
        assert!(repo.member_server(2, 11).await?.is_none());
        assert!(repo.member_server(1, 11).await?.is_some());
        Ok(())
    }
}
