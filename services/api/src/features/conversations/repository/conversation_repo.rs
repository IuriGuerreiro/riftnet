use std::collections::HashMap;

use anyhow::Context;
use async_trait::async_trait;

use super::scylla_conversation_repo::ScyllaConversationRepo;
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::conversations::models::{ConversationRecord, Kind, dm_key};

#[async_trait]
pub trait ConversationRepo: Send + Sync {
    async fn get_or_create_dm(
        &self,
        new_id: i64,
        a: i64,
        b: i64,
    ) -> Result<ConversationRecord, RepoError>;
    async fn list_for_user(&self, user_id: i64) -> Result<Vec<ConversationRecord>, RepoError>;
    async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError>;
    async fn next_seq(&self, id: i64) -> Result<i64, RepoError>;
}

#[async_trait]
impl ConversationRepo for ScyllaConversationRepo {
    #[tracing::instrument(name = "db INSERT dm_keys", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "INSERT", db.collection.name = "dm_keys"))]
    async fn get_or_create_dm(
        &self,
        new_id: i64,
        a: i64,
        b: i64,
    ) -> Result<ConversationRecord, RepoError> {
        let key = dm_key(a, b);

        let insert_reply = self
            .session
            .execute_unpaged(&self.claim_dm_key, (&key, new_id))
            .await
            .context("claim dm_key")?
            .into_rows_result()
            .context("claim dm_key")?;
        let dm_is_new = lwt_applied(&insert_reply).context("claim dm_key")?;

        let id = if dm_is_new {
            new_id
        } else {
            let mut read_dm_key = self.get_dm_key.clone();
            read_dm_key.set_consistency(scylla::statement::Consistency::Serial);
            let (id,) = self
                .session
                .execute_unpaged(&read_dm_key, (&key,))
                .await
                .context("read dm_key")?
                .into_rows_result()
                .context("read dm_key")?
                .first_row::<(i64,)>()
                .context("read dm_key")?;
            id
        };

        if let Some(existing) = self.get_by_id(id).await? {
            return Ok(existing);
        }
        let members = [a, b];
        self.write_conversation(id, Kind::Dm, &members).await?;
        Ok(ConversationRecord {
            id,
            kind: Kind::Dm,
            last_seq: 0,
            member_ids: members.to_vec(),
        })
    }

    #[tracing::instrument(name = "db SELECT conversations_by_user", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "conversations_by_user"))]
    async fn list_for_user(&self, user_id: i64) -> Result<Vec<ConversationRecord>, RepoError> {
        let ids: Vec<i64> = self
            .session
            .execute_unpaged(&self.list_by_user, (user_id,))
            .await
            .context("list conversations")?
            .into_rows_result()
            .context("list conversations")?
            .rows::<(i64,)>()
            .context("list conversations")?
            .map(|r| r.map(|(id,)| id))
            .collect::<Result<_, _>>()
            .context("list conversations")?;

        let found = futures::future::try_join_all(ids.iter().map(|id| self.get_by_id(*id))).await?;
        let mut by_id: HashMap<i64, ConversationRecord> =
            found.into_iter().flatten().map(|c| (c.id, c)).collect();
        Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
    }

    async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
        self.get_by_id(id).await
    }

    #[tracing::instrument(name = "db UPDATE conversations", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "UPDATE", db.collection.name = "conversations"))]
    async fn next_seq(&self, id: i64) -> Result<i64, RepoError> {
        // INVARIANT: compare-and-set via LWT, so two senders never get the same seq.
        let mut current = self.get_by_id(id).await?.map(|c| c.last_seq).unwrap_or(0);
        for _ in 0..20 {
            let next = current + 1;
            let reply = self
                .session
                .execute_unpaged(&self.bump_seq, (next, id, current))
                .await
                .context("bump seq")?
                .into_rows_result()
                .context("bump seq")?;
            if lwt_applied(&reply).context("bump seq")? {
                return Ok(next);
            }
            current = reply
                .rows::<scylla::value::Row>()
                .context("bump seq")?
                .next()
                .transpose()
                .context("bump seq")?
                .and_then(|row| row.columns.get(1).cloned().flatten())
                .and_then(|v| v.as_bigint())
                .unwrap_or(current);
        }
        Err(RepoError::Other(anyhow::anyhow!(
            "next_seq: too much contention on {id}"
        )))
    }
}
