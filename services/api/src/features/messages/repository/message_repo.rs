//! The `MessageRepo` trait (what the service needs from storage) and its
//! implementation for Scylla. The Scylla struct is in `scylla_message_repo.rs`.

use anyhow::Context;
use async_trait::async_trait;
use scylla::statement::Consistency;
use scylla::statement::batch::{Batch, BatchType};

use super::scylla_message_repo::{Row, ScyllaMessageRepo, to_message};
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::messages::models::{ChangeKind, Message, MessageChange, bucket_at, bucket_of};

#[async_trait]
pub trait MessageRepo: Send + Sync {
    /// Ties a client nonce to `new_id`. Returns `(id, true)` the first time,
    /// or `(the id from the first time, false)` for a retry.
    async fn claim_nonce(
        &self,
        conversation_id: i64,
        author_id: i64,
        nonce: &str,
        new_id: i64,
    ) -> Result<(i64, bool), RepoError>;
    async fn get(&self, conversation_id: i64, id: i64) -> Result<Option<Message>, RepoError>;
    async fn insert(&self, message: &Message) -> Result<(), RepoError>;
    /// Up to `limit` messages older than `before_id` (None = newest), newest first.
    /// Doesn't look before `oldest_id` (the conversation's creation).
    async fn history(
        &self,
        conversation_id: i64,
        before_id: Option<i64>,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError>;
    /// Messages with `seq > after_seq`, newest first, at most `limit`.
    /// Walks back from now and stops at the first message the client already has.
    async fn since_seq(
        &self,
        conversation_id: i64,
        after_seq: i64,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError>;
    /// Logs the edit as change `change_seq`, then saves the new content and
    /// `edited_at`. Returns false if the message no longer exists.
    async fn edit(&self, message: &Message, change_seq: i64) -> Result<bool, RepoError>;
    /// Removes the message for good and logs it as change `change_seq`
    /// (both or neither).
    async fn delete(&self, conversation_id: i64, id: i64, change_seq: i64)
    -> Result<(), RepoError>;
    /// Edits/deletes with `seq > after_seq`, oldest first, at most `limit`.
    async fn changes_since(
        &self,
        conversation_id: i64,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<MessageChange>, RepoError>;
}

#[async_trait]
impl MessageRepo for ScyllaMessageRepo {
    #[tracing::instrument(name = "db INSERT message_nonces", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "INSERT", db.collection.name = "message_nonces"))]
    async fn claim_nonce(
        &self,
        conversation_id: i64,
        author_id: i64,
        nonce: &str,
        new_id: i64,
    ) -> Result<(i64, bool), RepoError> {
        // Same pattern as dm_keys: only goes in if this nonce is new (IF NOT EXISTS).
        let insert_reply = self
            .session
            .execute_unpaged(
                &self.claim_nonce,
                (conversation_id, author_id, nonce, new_id),
            )
            .await
            .context("claim nonce")?
            .into_rows_result()
            .context("claim nonce")?;
        let is_first_send = lwt_applied(&insert_reply).context("claim nonce")?;
        if is_first_send {
            return Ok((new_id, true));
        }

        // A retry: read the message id the first send used.
        let mut read_nonce = self.get_nonce.clone();
        read_nonce.set_consistency(Consistency::Serial); // see the LWT's result for sure
        let (id,) = self
            .session
            .execute_unpaged(&read_nonce, (conversation_id, author_id, nonce))
            .await
            .context("read nonce")?
            .into_rows_result()
            .context("read nonce")?
            .first_row::<(i64,)>()
            .context("read nonce")?;
        Ok((id, false))
    }

    #[tracing::instrument(name = "db SELECT messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "messages"))]
    async fn get(&self, conversation_id: i64, id: i64) -> Result<Option<Message>, RepoError> {
        let row = self
            .session
            .execute_unpaged(&self.get_message, (conversation_id, bucket_of(id), id))
            .await
            .context("get message")?
            .into_rows_result()
            .context("get message")?
            .maybe_first_row::<Row>()
            .context("get message")?;
        Ok(row.map(to_message))
    }

    #[tracing::instrument(name = "db INSERT messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "INSERT", db.collection.name = "messages"))]
    async fn insert(&self, m: &Message) -> Result<(), RepoError> {
        self.session
            .execute_unpaged(
                &self.insert_message,
                (
                    m.conversation_id,
                    bucket_of(m.id),
                    m.id,
                    m.seq,
                    m.author_id,
                    &m.content,
                    m.encryption,
                ),
            )
            .await
            .context("insert message")?;
        Ok(())
    }

    #[tracing::instrument(name = "db SELECT messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "messages"))]
    async fn history(
        &self,
        conversation_id: i64,
        before_id: Option<i64>,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError> {
        // Walk buckets from newest to oldest until we have `limit` messages.
        // Each bucket is one partition = one fast read.
        let before = before_id.unwrap_or(i64::MAX);
        let newest_bucket = match before_id {
            Some(id) => bucket_of(id),
            None => bucket_at(chrono::Utc::now().timestamp_millis() as u64),
        };
        let oldest_bucket = bucket_of(oldest_id);

        let mut out = Vec::with_capacity(limit);
        for bucket in (oldest_bucket..=newest_bucket).rev() {
            let want = (limit - out.len()) as i32;
            let rows = self
                .session
                .execute_unpaged(&self.history, (conversation_id, bucket, before, want))
                .await
                .context("history")?
                .into_rows_result()
                .context("history")?;
            for row in rows.rows::<Row>().context("history")? {
                out.push(to_message(row.context("history")?));
            }
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    #[tracing::instrument(name = "db SELECT messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "messages"))]
    async fn since_seq(
        &self,
        conversation_id: i64,
        after_seq: i64,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError> {
        // Same walk as history (newest bucket first), but instead of counting
        // to a limit we stop at the first message the client already has.
        let newest_bucket = bucket_at(chrono::Utc::now().timestamp_millis() as u64);
        let oldest_bucket = bucket_of(oldest_id);

        let mut out = Vec::new();

        for bucket in (oldest_bucket..=newest_bucket).rev() {
            let want = (limit - out.len()) as i32;

            let rows = self
                .session
                .execute_unpaged(&self.history, (conversation_id, bucket, i64::MAX, want))
                .await
                .context("sync")?
                .into_rows_result()
                .context("sync")?;

            for row in rows.rows::<Row>().context("sync")? {
                let message = to_message(row.context("sync")?);
                if message.seq <= after_seq {
                    return Ok(out); // reached what the client has
                }
                out.push(message);
            }

            if out.len() >= limit {
                break;
            }
        }

        Ok(out)
    }

    #[tracing::instrument(name = "db UPDATE messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "UPDATE", db.collection.name = "messages"))]
    async fn edit(&self, m: &Message, change_seq: i64) -> Result<bool, RepoError> {
        // Log first: an LWT can't share a batch with other partitions. If the
        // update then finds no message, sync just skips this log row.
        self.session
            .execute_unpaged(
                &self.insert_change,
                (m.conversation_id, change_seq, m.id, ChangeKind::Edit as i8),
            )
            .await
            .context("log edit")?;
        let reply = self
            .session
            .execute_unpaged(
                &self.edit_message,
                (
                    &m.content,
                    m.edited_at,
                    m.conversation_id,
                    bucket_of(m.id),
                    m.id,
                ),
            )
            .await
            .context("edit message")?
            .into_rows_result()
            .context("edit message")?;
        Ok(lwt_applied(&reply).context("edit message")?)
    }

    #[tracing::instrument(name = "db DELETE messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "DELETE", db.collection.name = "messages"))]
    async fn delete(
        &self,
        conversation_id: i64,
        id: i64,
        change_seq: i64,
    ) -> Result<(), RepoError> {
        // Logged batch: the delete and its log row go in together, so an
        // offline client always hears about it on sync.
        let mut batch = Batch::new(BatchType::Logged);
        batch.append_statement(self.delete_message.clone());
        batch.append_statement(self.insert_change.clone());
        self.session
            .batch(
                &batch,
                (
                    (conversation_id, bucket_of(id), id),
                    (conversation_id, change_seq, id, ChangeKind::Delete as i8),
                ),
            )
            .await
            .context("delete message")?;
        Ok(())
    }

    #[tracing::instrument(name = "db SELECT message_changes", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "message_changes"))]
    async fn changes_since(
        &self,
        conversation_id: i64,
        after_seq: i64,
        limit: usize,
    ) -> Result<Vec<MessageChange>, RepoError> {
        let rows = self
            .session
            .execute_unpaged(
                &self.changes_since,
                (conversation_id, after_seq, limit as i32),
            )
            .await
            .context("changes since")?
            .into_rows_result()
            .context("changes since")?;
        let mut out = Vec::new();
        for row in rows.rows::<(i64, i64, i8)>().context("changes since")? {
            let (seq, message_id, kind) = row.context("changes since")?;
            if let Some(kind) = ChangeKind::from_i8(kind) {
                out.push(MessageChange {
                    seq,
                    message_id,
                    kind,
                });
            }
        }
        Ok(out)
    }
}
