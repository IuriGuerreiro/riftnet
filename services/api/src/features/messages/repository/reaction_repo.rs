use std::sync::Arc;

use anyhow::Context;
use async_trait::async_trait;
use scylla::client::session::Session;
use scylla::statement::prepared::PreparedStatement;

use super::queries as q;
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::messages::models::ReactionRow;

#[async_trait]
pub trait ReactionRepo: Send + Sync {
    /// false = already there.
    async fn add(
        &self,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        user_id: i64,
    ) -> Result<bool, RepoError>;
    /// false = wasn't there.
    async fn remove(
        &self,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        user_id: i64,
    ) -> Result<bool, RepoError>;
    async fn for_messages(
        &self,
        conversation_id: i64,
        message_ids: &[i64],
    ) -> Result<Vec<ReactionRow>, RepoError>;
}

pub struct ScyllaReactionRepo {
    session: Arc<Session>,
    add: PreparedStatement,
    remove: PreparedStatement,
    for_messages: PreparedStatement,
}

impl ScyllaReactionRepo {
    pub async fn new(session: Arc<Session>) -> anyhow::Result<Self> {
        let prepare = |cql: &'static str| {
            let session = session.clone();
            async move {
                session
                    .prepare(cql)
                    .await
                    .with_context(|| format!("prepare: {cql}"))
            }
        };
        Ok(Self {
            add: prepare(q::ADD_REACTION).await?,
            remove: prepare(q::REMOVE_REACTION).await?,
            for_messages: prepare(q::REACTIONS_FOR).await?,
            session,
        })
    }
}

#[async_trait]
impl ReactionRepo for ScyllaReactionRepo {
    #[tracing::instrument(name = "db INSERT message_reactions", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "INSERT", db.collection.name = "message_reactions"))]
    async fn add(
        &self,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        user_id: i64,
    ) -> Result<bool, RepoError> {
        let reply = self
            .session
            .execute_unpaged(&self.add, (conversation_id, message_id, emoji, user_id))
            .await
            .context("add reaction")?
            .into_rows_result()
            .context("add reaction")?;
        Ok(lwt_applied(&reply).context("add reaction")?)
    }

    #[tracing::instrument(name = "db DELETE message_reactions", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "DELETE", db.collection.name = "message_reactions"))]
    async fn remove(
        &self,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        user_id: i64,
    ) -> Result<bool, RepoError> {
        let reply = self
            .session
            .execute_unpaged(&self.remove, (conversation_id, message_id, emoji, user_id))
            .await
            .context("remove reaction")?
            .into_rows_result()
            .context("remove reaction")?;
        Ok(lwt_applied(&reply).context("remove reaction")?)
    }

    #[tracing::instrument(name = "db SELECT message_reactions", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "message_reactions"))]
    async fn for_messages(
        &self,
        conversation_id: i64,
        message_ids: &[i64],
    ) -> Result<Vec<ReactionRow>, RepoError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        // Keep each IN list small: every id is its own partition.
        for chunk in message_ids.chunks(50) {
            let rows = self
                .session
                .execute_unpaged(&self.for_messages, (conversation_id, chunk))
                .await
                .context("list reactions")?
                .into_rows_result()
                .context("list reactions")?;
            for row in rows
                .rows::<(i64, String, i64)>()
                .context("list reactions")?
            {
                let (message_id, emoji, user_id) = row.context("list reactions")?;
                out.push(ReactionRow {
                    message_id,
                    emoji,
                    user_id,
                });
            }
        }
        Ok(out)
    }
}
