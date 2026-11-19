use std::collections::HashMap;

use anyhow::Context;
use async_trait::async_trait;

use super::scylla_conversation_repo::ScyllaConversationRepo;
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::conversations::models::ConversationRecord;

#[async_trait]
pub trait ReadStateRepo: Send + Sync {
    async fn list_read(&self, user_id: i64) -> Result<HashMap<i64, i64>, RepoError>;
    async fn advance_read(
        &self,
        user_id: i64,
        conversation_id: i64,
        seq: i64,
    ) -> Result<(), RepoError>;
}

#[async_trait]
pub trait UnreadCounter: Send + Sync {
    async fn count_after(
        &self,
        conversation: &ConversationRecord,
        after_seq: i64,
        cap: u32,
    ) -> Result<u32, RepoError>;
}

#[async_trait]
impl ReadStateRepo for ScyllaConversationRepo {
    #[tracing::instrument(name = "db SELECT read_states", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "read_states"))]
    async fn list_read(&self, user_id: i64) -> Result<HashMap<i64, i64>, RepoError> {
        let rows = self
            .session
            .execute_unpaged(&self.list_read_states, (user_id,))
            .await
            .context("list read states")?
            .into_rows_result()
            .context("list read states")?;
        let mut out = HashMap::new();
        for row in rows
            .rows::<(i64, Option<i64>)>()
            .context("list read states")?
        {
            let (conversation_id, seq) = row.context("list read states")?;
            out.insert(conversation_id, seq.unwrap_or(0));
        }
        Ok(out)
    }

    #[tracing::instrument(name = "db UPDATE read_states", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "UPDATE", db.collection.name = "read_states"))]
    async fn advance_read(
        &self,
        user_id: i64,
        conversation_id: i64,
        seq: i64,
    ) -> Result<(), RepoError> {
        let inserted = self
            .session
            .execute_unpaged(&self.insert_read_state, (user_id, conversation_id, seq))
            .await
            .context("insert read state")?
            .into_rows_result()
            .context("insert read state")?;
        if lwt_applied(&inserted).context("insert read state")? {
            return Ok(());
        }
        self.session
            .execute_unpaged(
                &self.advance_read_state,
                (seq, user_id, conversation_id, seq),
            )
            .await
            .context("advance read state")?;
        Ok(())
    }
}
