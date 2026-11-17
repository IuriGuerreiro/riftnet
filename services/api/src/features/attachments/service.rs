use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use chrono::{DateTime, Utc};
use common::snowflake::Snowflake;

use super::models::{
    Attachment, CHUNK_SIZE, MAX_CONTENT_TYPE_LEN, MAX_FILENAME_CHARS, Status, chunk_count,
};
use super::repository::AttachmentRepo;
use crate::common::error::ApiError;
use crate::common::storage::FileStore;
use crate::features::conversations::repository::ConversationRepo;
use crate::features::messages::models::{MAX_ATTACHMENTS, MessageAttachment};

/// What messages need from attachments: tie files to a message at send,
/// let them go when it's deleted.
#[async_trait]
pub trait AttachmentLinker: Send + Sync {
    /// Ties the uploads to `message_id` and returns their details, in the
    /// order given. All or none. Calling again for the same message is fine.
    async fn attach(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        ids: &[i64],
    ) -> Result<Vec<MessageAttachment>, ApiError>;
    /// The message is gone: expire its files so the cleanup deletes them.
    async fn release(&self, message_id: i64) -> Result<(), ApiError>;
}

/// How long a download link works once handed out.
const DOWNLOAD_URL_TTL: Duration = Duration::from_secs(5 * 60);
/// Uploads not finished after this long are thrown away.
const STALE_UPLOAD: Duration = Duration::from_secs(24 * 60 * 60);
const CLEANUP_BATCH: i64 = 100;

pub struct Limits {
    pub max_bytes: i64,
    pub ttl: Duration,
}

pub struct NewUpload<'a> {
    pub conversation_id: i64,
    pub filename: &'a str,
    pub content_type: &'a str,
    pub size: i64,
    /// BLAKE3 of the whole file, hex. The downloader checks it.
    pub blake3_hex: &'a str,
}

pub struct AttachmentService {
    repo: Arc<dyn AttachmentRepo>,
    conversations: Arc<dyn ConversationRepo>,
    store: Arc<dyn FileStore>,
    ids: Arc<Snowflake>,
    limits: Limits,
}

impl AttachmentService {
    pub fn new(
        repo: Arc<dyn AttachmentRepo>,
        conversations: Arc<dyn ConversationRepo>,
        store: Arc<dyn FileStore>,
        ids: Arc<Snowflake>,
        limits: Limits,
    ) -> Self {
        Self {
            repo,
            conversations,
            store,
            ids,
            limits,
        }
    }

    #[tracing::instrument(name = "attachments.start", skip_all, fields(user.id = me, conversation.id = new.conversation_id))]
    pub async fn start(&self, me: i64, new: NewUpload<'_>) -> Result<Attachment, ApiError> {
        if new.size <= 0 {
            return Err(ApiError::bad_request("empty_file", "file is empty"));
        }
        if new.size > self.limits.max_bytes {
            return Err(ApiError::bad_request("file_too_large", "file is too large"));
        }
        let filename = clean_filename(new.filename)?;
        let content_type = clean_content_type(new.content_type);
        let blake3 = parse_hash(new.blake3_hex)?;
        self.check_member(me, new.conversation_id).await?;

        let id = self.ids.next_id() as i64;
        let object_key = format!("attachments/{}/{id}", new.conversation_id);
        let upload_id = self.store.start_upload(&object_key, &content_type).await?;
        let now = Utc::now();
        let attachment = Attachment {
            id,
            conversation_id: new.conversation_id,
            uploader_id: me,
            message_id: None,
            filename,
            content_type,
            size: new.size,
            chunk_size: CHUNK_SIZE as i32,
            chunk_count: chunk_count(new.size),
            object_key,
            upload_id,
            blake3: blake3.as_bytes().to_vec(),
            status: Status::Uploading.as_str().into(),
            created_at: now,
            expires_at: now + self.limits.ttl,
        };
        self.repo.insert(&attachment).await?;
        Ok(attachment)
    }

    /// Stores chunk `idx` only if its BLAKE3 matches `hash_hex`.
    #[tracing::instrument(name = "attachments.put_chunk", skip_all, fields(user.id = me, attachment.id = id, chunk.idx = idx))]
    pub async fn put_chunk(
        &self,
        me: i64,
        id: i64,
        idx: i32,
        hash_hex: &str,
        data: Bytes,
    ) -> Result<(), ApiError> {
        let claimed = parse_hash(hash_hex)?;
        let a = self.own_upload(me, id).await?;
        if idx < 0 || idx >= a.chunk_count {
            return Err(ApiError::bad_request(
                "bad_chunk",
                "chunk index out of range",
            ));
        }
        if data.len() as i64 != a.chunk_len(idx) {
            return Err(ApiError::bad_request(
                "bad_chunk",
                "chunk has the wrong size",
            ));
        }

        // BLAKE3 hashes ~GB/s, but 8 MiB still beats a cooperative yield; keep it off the runtime.
        let data_for_hash = data.clone();
        let actual = tokio::task::spawn_blocking(move || blake3::hash(&data_for_hash))
            .await
            .map_err(anyhow::Error::from)?;
        // blake3::Hash's == is constant-time.
        if actual != claimed {
            return Err(ApiError::bad_request(
                "hash_mismatch",
                "chunk hash doesn't match, re-send it",
            ));
        }

        let etag = self
            .store
            .put_part(&a.object_key, &a.upload_id, idx as u32, data)
            .await?;
        self.repo
            .put_chunk(id, idx, actual.as_bytes(), &etag)
            .await?;
        Ok(())
    }

    /// Joins the chunks into the final file. Safe to call twice.
    #[tracing::instrument(name = "attachments.complete", skip_all, fields(user.id = me, attachment.id = id))]
    pub async fn complete(&self, me: i64, id: i64) -> Result<Attachment, ApiError> {
        let mut a = self.own_attachment(me, id).await?;
        if a.is_ready() {
            return Ok(a);
        }
        let etags = self.repo.chunk_etags(id).await?;
        if etags.len() != a.chunk_count as usize {
            return Err(ApiError::bad_request(
                "missing_chunks",
                format!("{} of {} chunks uploaded", etags.len(), a.chunk_count),
            ));
        }
        self.store
            .finish_upload(&a.object_key, &a.upload_id, &etags)
            .await?;
        self.repo.mark_ready(id).await?;
        a.status = Status::Ready.as_str().into();
        Ok(a)
    }

    /// Returns the file's details and a short-lived download link.
    /// Only current members of the conversation get it, and only once it's sent.
    #[tracing::instrument(name = "attachments.download", skip_all, fields(user.id = me, attachment.id = id))]
    pub async fn download(&self, me: i64, id: i64) -> Result<(Attachment, String), ApiError> {
        let a = self
            .repo
            .get(id)
            .await?
            .filter(|a| a.is_ready() && a.message_id.is_some() && a.expires_at > Utc::now())
            .ok_or(ApiError::NotFound)?;
        self.check_member(me, a.conversation_id).await?;
        let url = self
            .store
            .download_url(&a.object_key, &a.filename, DOWNLOAD_URL_TTL)
            .await?;
        Ok((a, url))
    }

    /// Deletes expired files and abandoned uploads. Returns how many went.
    #[tracing::instrument(name = "attachments.cleanup", skip_all)]
    pub async fn cleanup(&self, now: DateTime<Utc>) -> Result<usize, ApiError> {
        let stale_before = now - STALE_UPLOAD;
        let mut removed = 0;
        loop {
            let dead = self
                .repo
                .find_dead(now, stale_before, CLEANUP_BATCH)
                .await?;
            let batch = dead.len();
            let mut batch_removed = 0;
            for a in dead {
                let gone = if a.is_ready() {
                    self.store.delete(&a.object_key).await
                } else {
                    self.store.abort_upload(&a.object_key, &a.upload_id).await
                };
                // WARN: on a store error keep the row, so the next run retries.
                if let Err(err) = gone {
                    tracing::warn!(error = %err, attachment.id = a.id, "cleanup: store delete failed");
                    continue;
                }
                self.repo.delete(a.id).await?;
                batch_removed += 1;
            }
            removed += batch_removed;
            // Stop on a short batch, or when nothing could be deleted (store down).
            if batch < CLEANUP_BATCH as usize || batch_removed == 0 {
                return Ok(removed);
            }
        }
    }

    // WARN: missing, not yours and not-a-member all look the same (404),
    // so nobody can probe which attachments or conversations exist.
    async fn check_member(&self, me: i64, conversation_id: i64) -> Result<(), ApiError> {
        self.conversations
            .get(conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .map(|_| ())
            .ok_or(ApiError::NotFound)
    }

    async fn own_attachment(&self, me: i64, id: i64) -> Result<Attachment, ApiError> {
        self.repo
            .get(id)
            .await?
            .filter(|a| a.uploader_id == me && a.expires_at > Utc::now())
            .ok_or(ApiError::NotFound)
    }

    async fn own_upload(&self, me: i64, id: i64) -> Result<Attachment, ApiError> {
        let a = self.own_attachment(me, id).await?;
        if a.is_ready() {
            return Err(ApiError::conflict(
                "upload_finished",
                "upload already finished",
            ));
        }
        Ok(a)
    }
}

#[async_trait]
impl AttachmentLinker for AttachmentService {
    #[tracing::instrument(name = "attachments.attach", skip_all, fields(user.id = me, message.id = message_id))]
    async fn attach(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        ids: &[i64],
    ) -> Result<Vec<MessageAttachment>, ApiError> {
        let mut unique: Vec<i64> = Vec::with_capacity(ids.len());
        for id in ids {
            if !unique.contains(id) {
                unique.push(*id);
            }
        }
        if unique.is_empty() {
            return Ok(Vec::new());
        }
        if unique.len() > MAX_ATTACHMENTS {
            return Err(ApiError::bad_request(
                "too_many_attachments",
                format!("at most {MAX_ATTACHMENTS} files per message"),
            ));
        }
        let mut claimed = self
            .repo
            .claim(&unique, me, conversation_id, message_id)
            .await?
            .ok_or_else(|| {
                ApiError::bad_request(
                    "bad_attachment",
                    "attachment not found, not finished, or already sent",
                )
            })?;
        claimed.sort_by_key(|a| unique.iter().position(|id| *id == a.id));
        Ok(claimed
            .into_iter()
            .map(|a| MessageAttachment {
                id: a.id,
                filename: a.filename,
                content_type: a.content_type,
                size: a.size,
                blake3: a.blake3,
                expires_at_ms: a.expires_at.timestamp_millis(),
            })
            .collect())
    }

    async fn release(&self, message_id: i64) -> Result<(), ApiError> {
        Ok(self.repo.expire_for_message(message_id).await?)
    }
}

fn parse_hash(hex: &str) -> Result<blake3::Hash, ApiError> {
    blake3::Hash::from_hex(hex)
        .map_err(|_| ApiError::bad_request("bad_hash", "hash must be 64 hex characters (BLAKE3)"))
}

fn clean_filename(name: &str) -> Result<String, ApiError> {
    // Keep only the last path part and drop control characters.
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base.chars().filter(|c| !c.is_control()).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return Err(ApiError::bad_request("bad_filename", "filename is empty"));
    }
    Ok(cleaned.chars().take(MAX_FILENAME_CHARS).collect())
}

fn clean_content_type(ct: &str) -> String {
    let ok = !ct.is_empty()
        && ct.len() <= MAX_CONTENT_TYPE_LEN
        && ct.contains('/')
        && ct
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/+-.;=_ ".contains(&b));
    if ok {
        ct.to_string()
    } else {
        "application/octet-stream".into()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use async_trait::async_trait;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::conversations::models::{ConversationRecord, Kind};

    const ALICE: i64 = 1;
    const BOB: i64 = 2;
    const EVE: i64 = 3;
    const DM: i64 = 100;

    struct FakeConversations;
    #[async_trait]
    impl ConversationRepo for FakeConversations {
        async fn get_or_create_dm(
            &self,
            _: i64,
            _: i64,
            _: i64,
        ) -> Result<ConversationRecord, RepoError> {
            unimplemented!()
        }
        async fn list_for_user(&self, _: i64) -> Result<Vec<ConversationRecord>, RepoError> {
            unimplemented!()
        }
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            Ok((id == DM).then(|| ConversationRecord {
                id: DM,
                kind: Kind::Dm,
                last_seq: 0,
                name: String::new(),
                member_ids: vec![ALICE, BOB],
            }))
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            unimplemented!()
        }
        async fn create_group(&self, _: &ConversationRecord) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn set_members(&self, _: i64, _: &[i64], _: &[i64]) -> Result<bool, RepoError> {
            unimplemented!()
        }
        async fn rename(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
    }

    #[derive(Default)]
    struct FakeRepo {
        rows: Mutex<HashMap<i64, Attachment>>,
        chunks: Mutex<HashMap<(i64, i32), String>>,
    }
    #[async_trait]
    impl AttachmentRepo for FakeRepo {
        async fn insert(&self, a: &Attachment) -> Result<(), RepoError> {
            self.rows.lock().unwrap().insert(a.id, a.clone());
            Ok(())
        }
        async fn get(&self, id: i64) -> Result<Option<Attachment>, RepoError> {
            Ok(self.rows.lock().unwrap().get(&id).cloned())
        }
        async fn put_chunk(
            &self,
            id: i64,
            idx: i32,
            _: &[u8],
            etag: &str,
        ) -> Result<(), RepoError> {
            self.chunks.lock().unwrap().insert((id, idx), etag.into());
            Ok(())
        }
        async fn chunk_etags(&self, id: i64) -> Result<Vec<String>, RepoError> {
            let chunks = self.chunks.lock().unwrap();
            let mut v: Vec<_> = chunks.iter().filter(|((a, _), _)| *a == id).collect();
            v.sort_by_key(|((_, i), _)| *i);
            Ok(v.into_iter().map(|(_, e)| e.clone()).collect())
        }
        async fn mark_ready(&self, id: i64) -> Result<bool, RepoError> {
            let mut rows = self.rows.lock().unwrap();
            let a = rows.get_mut(&id).unwrap();
            a.status = "ready".into();
            Ok(true)
        }
        async fn claim(
            &self,
            ids: &[i64],
            me: i64,
            conversation_id: i64,
            message_id: i64,
        ) -> Result<Option<Vec<Attachment>>, RepoError> {
            let mut rows = self.rows.lock().unwrap();
            let ok = |a: &Attachment| {
                a.uploader_id == me
                    && a.conversation_id == conversation_id
                    && a.is_ready()
                    && a.message_id.is_none_or(|m| m == message_id)
            };
            if !ids.iter().all(|id| rows.get(id).is_some_and(ok)) {
                return Ok(None);
            }
            Ok(Some(
                ids.iter()
                    .map(|id| {
                        let a = rows.get_mut(id).unwrap();
                        a.message_id = Some(message_id);
                        a.clone()
                    })
                    .collect(),
            ))
        }
        async fn expire_for_message(&self, message_id: i64) -> Result<(), RepoError> {
            for a in self.rows.lock().unwrap().values_mut() {
                if a.message_id == Some(message_id) {
                    a.expires_at = Utc::now();
                }
            }
            Ok(())
        }
        async fn find_dead(
            &self,
            now: DateTime<Utc>,
            stale: DateTime<Utc>,
            _: i64,
        ) -> Result<Vec<Attachment>, RepoError> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .values()
                .filter(|a| {
                    a.expires_at <= now || (a.message_id.is_none() && a.created_at <= stale)
                })
                .cloned()
                .collect())
        }
        async fn delete(&self, id: i64) -> Result<(), RepoError> {
            self.rows.lock().unwrap().remove(&id);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeStore {
        parts: Mutex<Vec<u32>>,
        deleted: Mutex<Vec<String>>,
    }
    #[async_trait]
    impl FileStore for FakeStore {
        async fn start_upload(&self, _: &str, _: &str) -> anyhow::Result<String> {
            Ok("up-1".into())
        }
        async fn put_part(&self, _: &str, _: &str, part: u32, _: Bytes) -> anyhow::Result<String> {
            self.parts.lock().unwrap().push(part);
            Ok(format!("etag-{part}"))
        }
        async fn finish_upload(&self, _: &str, _: &str, _: &[String]) -> anyhow::Result<()> {
            Ok(())
        }
        async fn abort_upload(&self, key: &str, _: &str) -> anyhow::Result<()> {
            self.deleted.lock().unwrap().push(key.into());
            Ok(())
        }
        async fn delete(&self, key: &str) -> anyhow::Result<()> {
            self.deleted.lock().unwrap().push(key.into());
            Ok(())
        }
        async fn download_url(&self, key: &str, _: &str, _: Duration) -> anyhow::Result<String> {
            Ok(format!("https://files.test/{key}"))
        }
    }

    fn service(max_bytes: i64) -> (AttachmentService, Arc<FakeRepo>, Arc<FakeStore>) {
        let repo = Arc::new(FakeRepo::default());
        let store = Arc::new(FakeStore::default());
        let svc = AttachmentService::new(
            repo.clone(),
            Arc::new(FakeConversations),
            store.clone(),
            Arc::new(Snowflake::new(1)),
            Limits {
                max_bytes,
                ttl: Duration::from_secs(7 * 24 * 60 * 60),
            },
        );
        (svc, repo, store)
    }

    fn upload<'a>(size: i64, hash: &'a str) -> NewUpload<'a> {
        NewUpload {
            conversation_id: DM,
            filename: "../../etc/cat.png",
            content_type: "image/png",
            size,
            blake3_hex: hash,
        }
    }

    #[tokio::test]
    async fn full_upload_then_member_downloads() {
        let (svc, _, store) = service(100 << 20);
        let data = Bytes::from(vec![7u8; CHUNK_SIZE as usize + 10]);
        let whole = blake3::hash(&data).to_hex();
        let a = svc
            .start(ALICE, upload(data.len() as i64, &whole))
            .await
            .unwrap();
        assert_eq!(a.filename, "cat.png");
        assert_eq!(a.chunk_count, 2);

        let c0 = data.slice(..CHUNK_SIZE as usize);
        let c1 = data.slice(CHUNK_SIZE as usize..);
        // Finishing early is refused.
        assert!(svc.complete(ALICE, a.id).await.is_err());
        svc.put_chunk(ALICE, a.id, 1, &blake3::hash(&c1).to_hex(), c1)
            .await
            .unwrap();
        svc.put_chunk(ALICE, a.id, 0, &blake3::hash(&c0).to_hex(), c0)
            .await
            .unwrap();
        assert_eq!(*store.parts.lock().unwrap(), vec![1, 0]);

        svc.complete(ALICE, a.id).await.unwrap();
        svc.complete(ALICE, a.id).await.unwrap(); // idempotent
        // Not downloadable until it's on a message.
        assert!(matches!(
            svc.download(BOB, a.id).await,
            Err(ApiError::NotFound)
        ));
        let on_msg = svc.attach(ALICE, DM, 900, &[a.id, a.id]).await.unwrap();
        assert_eq!(on_msg.len(), 1);
        assert_eq!(on_msg[0].filename, "cat.png");
        let (_, url) = svc.download(BOB, a.id).await.unwrap();
        assert!(url.contains(&a.id.to_string()));
    }

    #[tokio::test]
    async fn chunk_with_wrong_hash_is_rejected() {
        let (svc, _, store) = service(100 << 20);
        let data = Bytes::from_static(b"hello");
        let a = svc
            .start(ALICE, upload(5, &blake3::hash(&data).to_hex()))
            .await
            .unwrap();
        let wrong = blake3::hash(b"HELLO").to_hex();
        let err = svc
            .put_chunk(ALICE, a.id, 0, &wrong, data)
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "hash_mismatch",
                ..
            }
        ));
        assert!(store.parts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn chunk_with_wrong_size_is_rejected() {
        let (svc, _, _) = service(100 << 20);
        let h = blake3::hash(b"hi").to_hex();
        let a = svc.start(ALICE, upload(5, &h)).await.unwrap();
        let err = svc
            .put_chunk(ALICE, a.id, 0, &h, Bytes::from_static(b"hi"))
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "bad_chunk",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn non_members_get_404() {
        let (svc, _, _) = service(100 << 20);
        let data = Bytes::from_static(b"hello");
        let h = blake3::hash(&data).to_hex();
        assert!(matches!(
            svc.start(EVE, upload(5, &h)).await,
            Err(ApiError::NotFound)
        ));

        let a = svc.start(ALICE, upload(5, &h)).await.unwrap();
        // Only the uploader can add chunks.
        assert!(matches!(
            svc.put_chunk(BOB, a.id, 0, &h, data.clone()).await,
            Err(ApiError::NotFound)
        ));
        svc.put_chunk(ALICE, a.id, 0, &h, data).await.unwrap();
        svc.complete(ALICE, a.id).await.unwrap();
        svc.attach(ALICE, DM, 900, &[a.id]).await.unwrap();
        assert!(matches!(
            svc.download(EVE, a.id).await,
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn too_large_is_rejected() {
        let (svc, _, _) = service(10);
        let h = blake3::hash(b"x").to_hex();
        let err = svc.start(ALICE, upload(11, &h)).await.err().unwrap();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "file_too_large",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn cleanup_removes_expired_and_stale() {
        let (svc, repo, store) = service(100 << 20);
        let data = Bytes::from_static(b"hello");
        let h = blake3::hash(&data).to_hex();
        let done = svc.start(ALICE, upload(5, &h)).await.unwrap();
        svc.put_chunk(ALICE, done.id, 0, &h, data).await.unwrap();
        svc.complete(ALICE, done.id).await.unwrap();
        svc.attach(ALICE, DM, 900, &[done.id]).await.unwrap();
        let fresh = svc.start(ALICE, upload(5, &h)).await.unwrap();

        // Nothing is dead yet.
        assert_eq!(svc.cleanup(Utc::now()).await.unwrap(), 0);

        // Two days later the unfinished upload is stale; the ready file is not expired yet.
        let later = Utc::now() + chrono::Duration::days(2);
        assert_eq!(svc.cleanup(later).await.unwrap(), 1);
        assert!(repo.rows.lock().unwrap().get(&fresh.id).is_none());

        // After 8 days the ready file has expired too.
        let much_later = Utc::now() + chrono::Duration::days(8);
        assert_eq!(svc.cleanup(much_later).await.unwrap(), 1);
        assert_eq!(store.deleted.lock().unwrap().len(), 2);
        assert!(matches!(
            svc.download(BOB, done.id).await,
            Err(ApiError::NotFound)
        ));
    }

    async fn ready_upload(svc: &AttachmentService, who: i64) -> i64 {
        let data = Bytes::from_static(b"hello");
        let h = blake3::hash(&data).to_hex();
        let a = svc.start(who, upload(5, &h)).await.unwrap();
        svc.put_chunk(who, a.id, 0, &h, data).await.unwrap();
        svc.complete(who, a.id).await.unwrap();
        a.id
    }

    #[tokio::test]
    async fn attach_rules() {
        let (svc, _, _) = service(100 << 20);
        let mine = ready_upload(&svc, ALICE).await;
        let bobs = ready_upload(&svc, BOB).await;

        // Someone else's file: refused, and nothing gets claimed.
        let err = svc.attach(ALICE, DM, 1, &[mine, bobs]).await.unwrap_err();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "bad_attachment",
                ..
            }
        ));
        // Retry for the same message is fine; another message can't take it.
        svc.attach(ALICE, DM, 1, &[mine]).await.unwrap();
        svc.attach(ALICE, DM, 1, &[mine]).await.unwrap();
        assert!(svc.attach(ALICE, DM, 2, &[mine]).await.is_err());
        // Unfinished uploads can't be sent.
        let h = blake3::hash(b"x").to_hex();
        let pending = svc.start(ALICE, upload(5, &h)).await.unwrap();
        assert!(svc.attach(ALICE, DM, 3, &[pending.id]).await.is_err());
        // Cap per message.
        let many: Vec<i64> = (0..=MAX_ATTACHMENTS as i64).collect();
        let err = svc.attach(ALICE, DM, 4, &many).await.unwrap_err();
        assert!(matches!(
            err,
            ApiError::BadRequest {
                code: "too_many_attachments",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn released_files_stop_downloading_and_get_cleaned() {
        let (svc, _, store) = service(100 << 20);
        let id = ready_upload(&svc, ALICE).await;
        svc.attach(ALICE, DM, 7, &[id]).await.unwrap();
        svc.download(BOB, id).await.unwrap();

        svc.release(7).await.unwrap();
        assert!(matches!(
            svc.download(BOB, id).await,
            Err(ApiError::NotFound)
        ));
        assert_eq!(svc.cleanup(Utc::now()).await.unwrap(), 1);
        assert_eq!(store.deleted.lock().unwrap().len(), 1);
    }

    #[test]
    fn filenames_are_cleaned() {
        assert_eq!(clean_filename("a/b\\c.txt").unwrap(), "c.txt");
        assert_eq!(clean_filename("bad\u{0}name").unwrap(), "badname");
        assert!(clean_filename("..").is_err());
        assert!(clean_filename("dir/").is_err());
        assert_eq!(
            clean_content_type("text/html\r\nX: y"),
            "application/octet-stream"
        );
    }
}
