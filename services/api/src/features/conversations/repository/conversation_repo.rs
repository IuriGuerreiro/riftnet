//! The `ConversationRepo` trait (what the service needs from storage) and
//! its implementation for Scylla. The Scylla struct and helpers are in
//! `scylla_conversation_repo.rs`.

use std::collections::HashMap;

use anyhow::Context;
use async_trait::async_trait;

use super::scylla_conversation_repo::ScyllaConversationRepo;
use crate::common::error::RepoError;
use crate::features::conversations::models::{ConversationRecord, Kind, dm_key};

#[async_trait]
pub trait ConversationRepo: Send + Sync {
    /// Creates the DM between `a` and `b`, or returns the existing one.
    /// Safe if both users open it at the same moment.
    async fn get_or_create_dm(
        &self,
        new_id: i64,
        a: i64,
        b: i64,
    ) -> Result<ConversationRecord, RepoError>;
    /// Conversations `user_id` is in, newest first (max 200).
    
    async fn list_for_user(&self, user_id: i64) -> Result<Vec<ConversationRecord>, RepoError>;
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

        // 1. Try to claim the key with our new id. The first column of the
        //    reply is `[applied]`: true = we won, false = it already existed.
        let claim = self
            .session
            .execute_unpaged(&self.claim_dm_key, (&key, new_id))
            .await
            .context("claim dm_key")?
            .into_rows_result()
            .context("claim dm_key")?;
            
        let won = claim
            .rows::<scylla::value::Row>()
            .context("claim dm_key")?
            .next()
            .and_then(|r| r.ok())
            .and_then(|r| r.columns.first().cloned().flatten())
            .is_some_and(|v| v.as_boolean() == Some(true));

        let id = if won {
            new_id
        } else {
            // 2. Someone created it before us: read which id they used.
            //    SERIAL consistency = see the result of the LWT for sure.
            
            let mut get = self.get_dm_key.clone();
            get.set_consistency(scylla::statement::Consistency::Serial);
            let (id,) = self
                .session
                .execute_unpaged(&get, (&key,))
                .await
                .context("read dm_key")?
                .into_rows_result()
                .context("read dm_key")?
                .first_row::<(i64,)>()
                .context("read dm_key")?;
            id
        };

        // 3. Make sure the conversation rows exist. Normally only the winner
        //    writes them; this also repairs a crash between step 1 and 3.
        if let Some(existing) = self.get(id).await? {
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

        // Fetch them all at once (one request per conversation, in parallel).
        let found = futures::future::try_join_all(ids.iter().map(|id| self.get(*id))).await?;
        let mut by_id: HashMap<i64, ConversationRecord> =
            found.into_iter().flatten().map(|c| (c.id, c)).collect();
        Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
    }
}
