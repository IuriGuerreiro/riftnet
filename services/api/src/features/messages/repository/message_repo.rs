use anyhow::Context;
use async_trait::async_trait;
use scylla::statement::Consistency;
use scylla::statement::batch::{Batch, BatchType};

use super::scylla_message_repo::{Row, ScyllaMessageRepo, attachment_blobs, to_message};
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::messages::models::{ChangeKind, Message, MessageChange, bucket_at, bucket_of};

const SEQ_GRACE_MS: u64 = 10_000;

#[async_trait]
pub trait MessageRepo: Send + Sync {
    async fn claim_nonce(
        &self,
        conversation_id: i64,
        author_id: i64,
        nonce: &str,
        new_id: i64,
    ) -> Result<(i64, bool), RepoError>;
    async fn get(&self, conversation_id: i64, id: i64) -> Result<Option<Message>, RepoError>;
    async fn insert(&self, message: &Message) -> Result<(), RepoError>;
    async fn history(
        &self,
        conversation_id: i64,
        before_id: Option<i64>,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError>;
    async fn since_seq(
        &self,
        conversation_id: i64,
        after_seq: i64,
        limit: usize,
        oldest_id: i64,
    ) -> Result<Vec<Message>, RepoError>;
    async fn edit(&self, message: &Message, change_seq: i64) -> Result<bool, RepoError>;
    async fn delete(&self, conversation_id: i64, id: i64, change_seq: i64)
    -> Result<(), RepoError>;
    async fn was_deleted(&self, conversation_id: i64, id: i64) -> Result<bool, RepoError>;
    async fn log_reaction(
        &self,
        conversation_id: i64,
        id: i64,
        change_seq: i64,
    ) -> Result<(), RepoError>;
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

        let mut read_nonce = self.get_nonce.clone();
        read_nonce.set_consistency(Consistency::Serial);
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
                    attachment_blobs(m),
                    (m.reply_to != 0).then_some(m.reply_to),
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
        let newest_bucket = bucket_at(chrono::Utc::now().timestamp_millis() as u64);
        let oldest_bucket = bucket_of(oldest_id);

        let mut out = Vec::new();
        let mut stop_below: Option<u64> = None;

        for bucket in (oldest_bucket..=newest_bucket).rev() {
            let mut before = i64::MAX;
            loop {
                let want = (limit - out.len()) as i32;
                let rows = self
                    .session
                    .execute_unpaged(&self.history, (conversation_id, bucket, before, want))
                    .await
                    .context("sync")?
                    .into_rows_result()
                    .context("sync")?;
                let mut got = 0;
                for row in rows.rows::<Row>().context("sync")? {
                    let message = to_message(row.context("sync")?);
                    got += 1;
                    before = message.id;
                    let ms = common::snowflake::timestamp_ms(message.id as u64);
                    if message.seq <= after_seq {
                        stop_below.get_or_insert(ms.saturating_sub(SEQ_GRACE_MS));
                    } else {
                        out.push(message);
                    }
                    if stop_below.is_some_and(|stop| ms < stop) || out.len() >= limit {
                        return Ok(out);
                    }
                }
                if got < want {
                    break;
                }
            }
        }

        Ok(out)
    }

    #[tracing::instrument(name = "db UPDATE messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "UPDATE", db.collection.name = "messages"))]
    async fn edit(&self, m: &Message, change_seq: i64) -> Result<bool, RepoError> {
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
        if !lwt_applied(&reply).context("edit message")? {
            return Ok(false);
        }
        self.session
            .execute_unpaged(
                &self.insert_change,
                (m.conversation_id, change_seq, m.id, ChangeKind::Edit as i8),
            )
            .await
            .context("log edit")?;
        Ok(true)
    }

    #[tracing::instrument(name = "db DELETE messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "DELETE", db.collection.name = "messages"))]
    async fn delete(
        &self,
        conversation_id: i64,
        id: i64,
        change_seq: i64,
    ) -> Result<(), RepoError> {
        let mut batch = Batch::new(BatchType::Logged);
        batch.append_statement(self.delete_message.clone());
        batch.append_statement(self.insert_change.clone());
        batch.append_statement(self.mark_deleted.clone());
        batch.append_statement(self.delete_reactions.clone());
        self.session
            .batch(
                &batch,
                (
                    (conversation_id, bucket_of(id), id),
                    (conversation_id, change_seq, id, ChangeKind::Delete as i8),
                    (conversation_id, id),
                    (conversation_id, id),
                ),
            )
            .await
            .context("delete message")?;
        Ok(())
    }

    #[tracing::instrument(name = "db INSERT message_changes", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "INSERT", db.collection.name = "message_changes"))]
    async fn log_reaction(
        &self,
        conversation_id: i64,
        id: i64,
        change_seq: i64,
    ) -> Result<(), RepoError> {
        self.session
            .execute_unpaged(
                &self.insert_change,
                (conversation_id, change_seq, id, ChangeKind::Reaction as i8),
            )
            .await
            .context("log reaction")?;
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

    #[tracing::instrument(name = "db SELECT deleted_messages", skip_all, err(Display), fields(otel.kind = "client", db.system = "scylladb", db.operation = "SELECT", db.collection.name = "deleted_messages"))]
    async fn was_deleted(&self, conversation_id: i64, id: i64) -> Result<bool, RepoError> {
        let row = self
            .session
            .execute_unpaged(&self.was_deleted, (conversation_id, id))
            .await
            .context("was deleted")?
            .into_rows_result()
            .context("was deleted")?
            .maybe_first_row::<(i64,)>()
            .context("was deleted")?;
        Ok(row.is_some())
    }
}

#[async_trait]
impl<T: MessageRepo + ?Sized> crate::features::conversations::repository::UnreadCounter for T {
    async fn count_after(
        &self,
        conversation: &crate::features::conversations::models::ConversationRecord,
        after_seq: i64,
        cap: u32,
    ) -> Result<u32, RepoError> {
        if conversation.last_seq <= after_seq || cap == 0 {
            return Ok(0);
        }
        let found = self
            .since_seq(conversation.id, after_seq, cap as usize, conversation.id)
            .await?;
        Ok(found.len() as u32)
    }
}

#[async_trait]
pub trait ChannelMessageRepo: MessageRepo {
    async fn insert_channel_message(&self, message: &Message) -> Result<bool, RepoError>;
}
