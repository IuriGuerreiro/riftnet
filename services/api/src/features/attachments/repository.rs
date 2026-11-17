use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

use super::models::Attachment;
use crate::common::error::RepoError;

#[async_trait]
pub trait AttachmentRepo: Send + Sync {
    async fn insert(&self, a: &Attachment) -> Result<(), RepoError>;
    async fn get(&self, id: i64) -> Result<Option<Attachment>, RepoError>;
    /// Saves a verified chunk. Re-sending the same chunk overwrites it (retries).
    async fn put_chunk(
        &self,
        id: i64,
        idx: i32,
        blake3: &[u8],
        etag: &str,
    ) -> Result<(), RepoError>;
    /// 'uploading' -> 'ready'. False if it wasn't uploading any more.
    async fn mark_ready(&self, id: i64) -> Result<bool, RepoError>;
    /// Ties the files to `message_id`, all or none. Each must be the uploader's,
    /// in the conversation, ready, unexpired, and not on another message
    /// (the same message again is fine: send retries). None if any fails.
    async fn claim(
        &self,
        ids: &[i64],
        uploader_id: i64,
        conversation_id: i64,
        message_id: i64,
    ) -> Result<Option<Vec<Attachment>>, RepoError>;
    /// Marks the message's files expired; the next cleanup deletes them.
    async fn expire_for_message(
        &self,
        message_id: i64,
        uploader_id: i64,
        conversation_id: i64,
    ) -> Result<(), RepoError>;
    /// Expired files, files created before `stale_before` that were never
    /// sent, and rows a previous cleanup run didn't finish.
    /// `mark_deleting` confirms each one before anything is removed.
    async fn find_dead(
        &self,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Attachment>, RepoError>;
    /// Flips the row to 'deleting' if it's still dead. False if it was
    /// claimed for a message in the meantime: leave it alone.
    async fn mark_deleting(
        &self,
        id: i64,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
    ) -> Result<bool, RepoError>;
    async fn delete(&self, id: i64) -> Result<(), RepoError>;
}

pub struct PgAttachmentRepo {
    pool: PgPool,
}

impl PgAttachmentRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AttachmentRepo for PgAttachmentRepo {
    #[tracing::instrument(name = "db INSERT attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "attachments"))]
    async fn insert(&self, a: &Attachment) -> Result<(), RepoError> {
        sqlx::query(
            "INSERT INTO attachments (id, conversation_id, uploader_id, message_id, filename, content_type, \
             size, chunk_size, chunk_count, object_key, upload_id, blake3, status, created_at, expires_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        )
        .bind(a.id)
        .bind(a.conversation_id)
        .bind(a.uploader_id)
        .bind(a.message_id)
        .bind(&a.filename)
        .bind(&a.content_type)
        .bind(a.size)
        .bind(a.chunk_size)
        .bind(a.chunk_count)
        .bind(&a.object_key)
        .bind(&a.upload_id)
        .bind(&a.blake3)
        .bind(&a.status)
        .bind(a.created_at)
        .bind(a.expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "db SELECT attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "attachments"))]
    async fn get(&self, id: i64) -> Result<Option<Attachment>, RepoError> {
        Ok(sqlx::query_as("SELECT * FROM attachments WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?)
    }

    #[tracing::instrument(name = "db INSERT attachment_chunks", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "INSERT", db.collection.name = "attachment_chunks"))]
    async fn put_chunk(
        &self,
        id: i64,
        idx: i32,
        blake3: &[u8],
        etag: &str,
    ) -> Result<(), RepoError> {
        sqlx::query(
            "INSERT INTO attachment_chunks (attachment_id, idx, blake3, etag) VALUES ($1, $2, $3, $4) \
             ON CONFLICT (attachment_id, idx) DO UPDATE SET blake3 = EXCLUDED.blake3, etag = EXCLUDED.etag",
        )
        .bind(id)
        .bind(idx)
        .bind(blake3)
        .bind(etag)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "db UPDATE attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "attachments"))]
    async fn mark_ready(&self, id: i64) -> Result<bool, RepoError> {
        let done = sqlx::query(
            "UPDATE attachments SET status = 'ready' WHERE id = $1 AND status = 'uploading'",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    #[tracing::instrument(name = "db UPDATE attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "attachments"))]
    async fn claim(
        &self,
        ids: &[i64],
        uploader_id: i64,
        conversation_id: i64,
        message_id: i64,
    ) -> Result<Option<Vec<Attachment>>, RepoError> {
        let mut tx = self.pool.begin().await?;
        let claimed: Vec<Attachment> = sqlx::query_as(
            "UPDATE attachments SET message_id = $1 \
             WHERE id = ANY($2) AND uploader_id = $3 AND conversation_id = $4 \
               AND status = 'ready' AND expires_at > now() \
               AND (message_id IS NULL OR message_id = $1) \
             RETURNING *",
        )
        .bind(message_id)
        .bind(ids)
        .bind(uploader_id)
        .bind(conversation_id)
        .fetch_all(&mut *tx)
        .await?;
        if claimed.len() != ids.len() {
            tx.rollback().await?;
            return Ok(None);
        }
        tx.commit().await?;
        Ok(Some(claimed))
    }

    #[tracing::instrument(name = "db UPDATE attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "attachments"))]
    async fn expire_for_message(
        &self,
        message_id: i64,
        uploader_id: i64,
        conversation_id: i64,
    ) -> Result<(), RepoError> {
        sqlx::query(
            "UPDATE attachments SET expires_at = LEAST(expires_at, now()) \
             WHERE message_id = $1 AND uploader_id = $2 AND conversation_id = $3",
        )
        .bind(message_id)
        .bind(uploader_id)
        .bind(conversation_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "db SELECT attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "SELECT", db.collection.name = "attachments"))]
    async fn find_dead(
        &self,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<Attachment>, RepoError> {
        Ok(sqlx::query_as(
            "SELECT * FROM attachments WHERE expires_at <= $1 \
             UNION \
             SELECT * FROM attachments WHERE message_id IS NULL AND created_at <= $2 \
             UNION \
             SELECT * FROM attachments WHERE status = 'deleting' \
             LIMIT $3",
        )
        .bind(now)
        .bind(stale_before)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    #[tracing::instrument(name = "db UPDATE attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "UPDATE", db.collection.name = "attachments"))]
    async fn mark_deleting(
        &self,
        id: i64,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
    ) -> Result<bool, RepoError> {
        // Row lock: a concurrent claim() either lands first (then this matches
        // nothing) or waits and then fails its status = 'ready' check.
        let done = sqlx::query(
            "UPDATE attachments SET status = 'deleting' WHERE id = $1 AND ( \
               status = 'deleting' OR expires_at <= $2 \
               OR (message_id IS NULL AND created_at <= $3))",
        )
        .bind(id)
        .bind(now)
        .bind(stale_before)
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    #[tracing::instrument(name = "db DELETE attachments", skip_all, err(Display), fields(otel.kind = "client", db.system = "postgresql", db.operation = "DELETE", db.collection.name = "attachments"))]
    async fn delete(&self, id: i64) -> Result<(), RepoError> {
        sqlx::query("DELETE FROM attachments WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
