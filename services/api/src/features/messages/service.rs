use std::sync::Arc;

use common::snowflake::Snowflake;
use protocol::Message as _;
use protocol::v1::{Envelope, MessageCreated, MessageDeleted, MessageUpdated, envelope::Payload};

use super::models::{ChangeKind, MAX_CONTENT_BYTES, MAX_NONCE_LEN, MAX_SYNC, Message};
use super::repository::MessageRepo;
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::attachments::service::AttachmentLinker;
use crate::features::conversations::models::ConversationRecord;
use crate::features::conversations::repository::ConversationRepo;

#[derive(Debug, Default)]
pub struct SyncResult {
    pub messages: Vec<Message>,
    pub complete: bool,
    pub edited: Vec<Message>,
    pub deleted_ids: Vec<i64>,
    pub last_seq: i64,
}

pub struct MessageService {
    repo: Arc<dyn MessageRepo>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
    attachments: Arc<dyn AttachmentLinker>,
}

impl MessageService {
    pub fn new(
        repo: Arc<dyn MessageRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
        attachments: Arc<dyn AttachmentLinker>,
    ) -> Self {
        Self {
            repo,
            conversations,
            events,
            ids,
            attachments,
        }
    }

    #[tracing::instrument(name = "messages.send", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn send(
        &self,
        me: i64,
        conversation_id: i64,
        content: Vec<u8>,
        attachment_ids: &[i64],
        nonce: &str,
    ) -> Result<Message, ApiError> {
        check_content(&content, !attachment_ids.is_empty())?;
        if nonce.is_empty() || nonce.len() > MAX_NONCE_LEN {
            return Err(ApiError::bad_request(
                "bad_nonce",
                "nonce must be 1-64 characters",
            ));
        }
        let conversation = self.member_conversation(me, conversation_id).await?;

        let (id, is_first_send) = self
            .repo
            .claim_nonce(conversation_id, me, nonce, self.ids.next_id() as i64)
            .await?;
        if !is_first_send {
            if let Some(mut existing) = self.repo.get(conversation_id, id).await? {
                self.sign_previews(std::slice::from_mut(&mut existing))
                    .await;
                return Ok(existing);
            }
            if self.repo.was_deleted(conversation_id, id).await? {
                return Err(message_not_found());
            }
        }

        // Postgres first, then Scylla. If the Scylla write fails, the client's
        // retry (same nonce, same id) claims the same files again, which is allowed.
        let attachments = self
            .attachments
            .attach(me, conversation_id, id, attachment_ids)
            .await?;
        let seq = self.conversations.next_seq(conversation_id).await?;
        let mut message = Message {
            id,
            conversation_id,
            author_id: me,
            seq,
            content,
            encryption: 0,
            edited_at: 0,
            attachments,
        };
        self.repo.insert(&message).await?;
        // WARN: sign after the insert so the link is never stored, and before the push so all members get it.
        self.sign_previews(std::slice::from_mut(&mut message)).await;

        let push = Payload::MessageCreated(MessageCreated {
            message: Some((&message).into()),
        });
        self.push(&conversation.member_ids, push).await;
        Ok(message)
    }

    #[tracing::instrument(name = "messages.history", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn history(
        &self,
        me: i64,
        conversation_id: i64,
        before_id: Option<i64>,
        limit: u32,
    ) -> Result<Vec<Message>, ApiError> {
        let conversation = self.member_conversation(me, conversation_id).await?;
        let limit = if limit == 0 { 50 } else { limit.min(100) } as usize;
        let mut messages = self
            .repo
            .history(conversation_id, before_id, limit, conversation.id)
            .await?;
        self.sign_previews(&mut messages).await;
        Ok(messages)
    }

    #[tracing::instrument(name = "messages.sync", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn sync(
        &self,
        me: i64,
        conversation_id: i64,
        after_seq: i64,
    ) -> Result<SyncResult, ApiError> {
        let conversation = self.member_conversation(me, conversation_id).await?;
        if conversation.last_seq <= after_seq {
            return Ok(SyncResult {
                complete: true,
                last_seq: after_seq,
                ..Default::default()
            });
        }
        let mut messages = self
            .repo
            .since_seq(conversation_id, after_seq, MAX_SYNC + 1, conversation.id)
            .await?;
        let changes = self
            .repo
            .changes_since(conversation_id, after_seq, MAX_SYNC + 1)
            .await?;
        if messages.len() > MAX_SYNC || changes.len() > MAX_SYNC {
            messages.truncate(MAX_SYNC);
            messages.sort_by_key(|m| m.seq);
            self.sign_previews(&mut messages).await;
            return Ok(SyncResult {
                messages,
                complete: false,
                last_seq: conversation.last_seq,
                ..Default::default()
            });
        }
        messages.sort_by_key(|m| m.seq);

        let mut result = SyncResult {
            complete: true,
            last_seq: after_seq,
            ..Default::default()
        };
        let mut seen = std::collections::HashSet::new();
        for change in changes.iter().rev() {
            if !seen.insert(change.message_id) {
                continue;
            }
            match change.kind {
                ChangeKind::Delete => result.deleted_ids.push(change.message_id),
                ChangeKind::Edit if messages.iter().any(|m| m.id == change.message_id) => {}
                ChangeKind::Edit => {
                    if let Some(m) = self.repo.get(conversation_id, change.message_id).await? {
                        result.edited.push(m);
                    }
                }
            }
        }
        for m in &messages {
            result.last_seq = result.last_seq.max(m.seq);
        }
        if let Some(last) = changes.last() {
            result.last_seq = result.last_seq.max(last.seq);
        }
        self.sign_previews(&mut messages).await;
        self.sign_previews(&mut result.edited).await;
        result.messages = messages;
        Ok(result)
    }

    #[tracing::instrument(name = "messages.edit", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn edit(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        content: Vec<u8>,
    ) -> Result<(Message, i64), ApiError> {
        let conversation = self.member_conversation(me, conversation_id).await?;
        let mut message = self
            .repo
            .get(conversation_id, message_id)
            .await?
            .ok_or_else(message_not_found)?;
        check_content(&content, !message.attachments.is_empty())?;
        if message.author_id != me {
            return Err(not_your_message());
        }

        let seq = self.conversations.next_seq(conversation_id).await?;
        message.content = content;
        message.edited_at = chrono::Utc::now().timestamp_millis();
        if !self.repo.edit(&message, seq).await? {
            return Err(message_not_found());
        }
        self.sign_previews(std::slice::from_mut(&mut message)).await;

        let push = Payload::MessageUpdated(MessageUpdated {
            message: Some((&message).into()),
            seq: seq as u64,
        });
        self.push(&conversation.member_ids, push).await;
        Ok((message, seq))
    }

    #[tracing::instrument(name = "messages.delete", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn delete(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
    ) -> Result<Option<i64>, ApiError> {
        let conversation = self.member_conversation(me, conversation_id).await?;
        let Some(message) = self.repo.get(conversation_id, message_id).await? else {
            return Ok(None);
        };
        if message.author_id != me {
            return Err(not_your_message());
        }

        // Files first: if this fails the message stays and a retry redoes both.
        // (The other order could leave a deleted message's files downloadable.)
        if !message.attachments.is_empty() {
            self.attachments
                .release(me, conversation_id, message_id)
                .await?;
        }
        let seq = self.conversations.next_seq(conversation_id).await?;
        self.repo.delete(conversation_id, message_id, seq).await?;

        let push = Payload::MessageDeleted(MessageDeleted {
            conversation_id: conversation_id as u64,
            message_id: message_id as u64,
            seq: seq as u64,
        });
        self.push(&conversation.member_ids, push).await;
        Ok(Some(seq))
    }

    /// Adds inline preview links to images/videos. Encrypted messages are
    /// skipped: their files are ciphertext a browser can't show.
    async fn sign_previews(&self, messages: &mut [Message]) {
        for m in messages.iter_mut().filter(|m| m.encryption == 0) {
            if m.attachments.iter().any(|a| a.is_media()) {
                self.attachments
                    .sign_previews(m.conversation_id, &mut m.attachments)
                    .await;
            }
        }
    }

    async fn push(&self, member_ids: &[i64], payload: Payload) {
        let envelope = Envelope {
            id: 0,
            payload: Some(payload),
        };
        if let Err(err) = self
            .events
            .publish_to_users(member_ids, envelope.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "live delivery failed");
        }
    }

    // WARN: same error for missing and not-a-member, so we never reveal which conversations exist.
    async fn member_conversation(
        &self,
        me: i64,
        conversation_id: i64,
    ) -> Result<ConversationRecord, ApiError> {
        self.conversations
            .get(conversation_id)
            .await?
            .filter(|c| c.member_ids.contains(&me))
            .ok_or_else(|| {
                ApiError::bad_request("conversation_not_found", "conversation not found")
            })
    }
}

/// Text may be empty only when the message has files.
fn check_content(content: &[u8], has_attachments: bool) -> Result<(), ApiError> {
    if content.is_empty() && !has_attachments {
        return Err(ApiError::bad_request("empty_message", "message is empty"));
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(ApiError::bad_request(
            "message_too_long",
            "message is too long",
        ));
    }
    Ok(())
}

fn message_not_found() -> ApiError {
    ApiError::bad_request("message_not_found", "message not found")
}

fn not_your_message() -> ApiError {
    ApiError::bad_request("not_your_message", "you can only change your own messages")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use bytes::Bytes;
    use futures::stream::BoxStream;

    use super::*;
    use crate::common::error::RepoError;
    use crate::features::conversations::models::Kind;
    use crate::features::messages::models::MessageChange;

    const ALICE: i64 = 1;
    const BOB: i64 = 2;
    const EVE: i64 = 3;
    const DM: i64 = 100;

    struct NoAttachments;
    #[async_trait]
    impl AttachmentLinker for NoAttachments {
        async fn attach(
            &self,
            _: i64,
            _: i64,
            _: i64,
            ids: &[i64],
        ) -> Result<Vec<crate::features::messages::models::MessageAttachment>, ApiError> {
            if ids.is_empty() {
                Ok(Vec::new())
            } else {
                Err(ApiError::bad_request("bad_attachment", "no files here"))
            }
        }
        async fn release(&self, _: i64, _: i64, _: i64) -> Result<(), ApiError> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeConversations {
        last_seq: Mutex<i64>,
    }
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
        async fn create_group(&self, _: &ConversationRecord) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn set_members(&self, _: i64, _: &[i64], _: &[i64]) -> Result<bool, RepoError> {
            unimplemented!()
        }
        async fn rename(&self, _: i64, _: &str) -> Result<(), RepoError> {
            unimplemented!()
        }
        async fn get(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
            Ok((id == DM).then(|| ConversationRecord {
                id,
                kind: Kind::Dm,
                last_seq: *self.last_seq.lock().unwrap(),
                name: String::new(),
                member_ids: vec![ALICE, BOB],
            }))
        }
        async fn next_seq(&self, _: i64) -> Result<i64, RepoError> {
            let mut seq = self.last_seq.lock().unwrap();
            *seq += 1;
            Ok(*seq)
        }
    }

    #[derive(Default)]
    struct FakeMessages {
        messages: Mutex<Vec<Message>>,
        changes: Mutex<Vec<MessageChange>>,
        nonces: Mutex<std::collections::HashMap<String, i64>>,
        deleted: Mutex<Vec<i64>>,
    }
    #[async_trait]
    impl MessageRepo for FakeMessages {
        async fn claim_nonce(
            &self,
            _: i64,
            _: i64,
            nonce: &str,
            new_id: i64,
        ) -> Result<(i64, bool), RepoError> {
            let mut nonces = self.nonces.lock().unwrap();
            match nonces.get(nonce) {
                Some(id) => Ok((*id, false)),
                None => {
                    nonces.insert(nonce.to_string(), new_id);
                    Ok((new_id, true))
                }
            }
        }
        async fn get(&self, _: i64, id: i64) -> Result<Option<Message>, RepoError> {
            Ok(self
                .messages
                .lock()
                .unwrap()
                .iter()
                .find(|m| m.id == id)
                .cloned())
        }
        async fn insert(&self, m: &Message) -> Result<(), RepoError> {
            self.messages.lock().unwrap().push(m.clone());
            Ok(())
        }
        async fn history(
            &self,
            _: i64,
            _: Option<i64>,
            limit: usize,
            _: i64,
        ) -> Result<Vec<Message>, RepoError> {
            let mut all = self.messages.lock().unwrap().clone();
            all.reverse();
            all.truncate(limit);
            Ok(all)
        }
        async fn since_seq(
            &self,
            _: i64,
            after_seq: i64,
            limit: usize,
            _: i64,
        ) -> Result<Vec<Message>, RepoError> {
            let mut out: Vec<_> = self
                .messages
                .lock()
                .unwrap()
                .iter()
                .filter(|m| m.seq > after_seq)
                .cloned()
                .collect();
            out.reverse();
            out.truncate(limit);
            Ok(out)
        }
        async fn edit(&self, m: &Message, change_seq: i64) -> Result<bool, RepoError> {
            let mut all = self.messages.lock().unwrap();
            let Some(row) = all.iter_mut().find(|x| x.id == m.id) else {
                return Ok(false);
            };
            row.content = m.content.clone();
            row.edited_at = m.edited_at;
            self.changes.lock().unwrap().push(MessageChange {
                seq: change_seq,
                message_id: m.id,
                kind: ChangeKind::Edit,
            });
            Ok(true)
        }
        async fn was_deleted(&self, _: i64, id: i64) -> Result<bool, RepoError> {
            Ok(self.deleted.lock().unwrap().contains(&id))
        }
        async fn delete(&self, _: i64, id: i64, change_seq: i64) -> Result<(), RepoError> {
            self.messages.lock().unwrap().retain(|m| m.id != id);
            self.deleted.lock().unwrap().push(id);
            self.changes.lock().unwrap().push(MessageChange {
                seq: change_seq,
                message_id: id,
                kind: ChangeKind::Delete,
            });
            Ok(())
        }
        async fn changes_since(
            &self,
            _: i64,
            after_seq: i64,
            limit: usize,
        ) -> Result<Vec<MessageChange>, RepoError> {
            let mut out: Vec<_> = self
                .changes
                .lock()
                .unwrap()
                .iter()
                .filter(|c| c.seq > after_seq)
                .copied()
                .collect();
            out.truncate(limit);
            Ok(out)
        }
    }

    #[derive(Default)]
    struct FakeEvents {
        sent: Mutex<Vec<(i64, &'static str)>>,
    }
    #[async_trait]
    impl EventBus for FakeEvents {
        async fn publish_to_users(&self, user_ids: &[i64], payload: Bytes) -> anyhow::Result<()> {
            let kind = match Envelope::decode(payload)?.payload {
                Some(Payload::MessageCreated(_)) => "created",
                Some(Payload::MessageUpdated(_)) => "updated",
                Some(Payload::MessageDeleted(_)) => "deleted",
                _ => "other",
            };
            self.sent
                .lock()
                .unwrap()
                .extend(user_ids.iter().map(|u| (*u, kind)));
            Ok(())
        }
        async fn subscribe_user(&self, _: i64) -> anyhow::Result<BoxStream<'static, Bytes>> {
            unimplemented!()
        }
    }

    struct Setup {
        svc: MessageService,
        repo: Arc<FakeMessages>,
        conversations: Arc<FakeConversations>,
        events: Arc<FakeEvents>,
    }

    fn setup() -> Setup {
        let repo = Arc::new(FakeMessages::default());
        let events = Arc::new(FakeEvents::default());
        let conversations = Arc::new(FakeConversations::default());
        let svc = MessageService::new(
            repo.clone(),
            conversations.clone(),
            events.clone(),
            Arc::new(Snowflake::new(1)),
            Arc::new(NoAttachments),
        );
        Setup {
            svc,
            repo,
            conversations,
            events,
        }
    }

    impl Setup {
        async fn send(&self, from: i64, text: &str) -> Message {
            let nonce = format!("n-{}", self.repo.nonces.lock().unwrap().len());
            self.svc
                .send(from, DM, text.into(), &[], &nonce)
                .await
                .unwrap()
        }
        fn pushes(&self, user: i64) -> Vec<&'static str> {
            self.events
                .sent
                .lock()
                .unwrap()
                .iter()
                .filter(|(u, _)| *u == user)
                .map(|(_, k)| *k)
                .collect()
        }
    }

    fn code(err: ApiError) -> &'static str {
        err.describe().1
    }

    #[tokio::test]
    async fn author_can_edit_and_everyone_is_told() {
        let t = setup();
        let m = t.send(ALICE, "helo").await;

        let (edited, seq) = t.svc.edit(ALICE, DM, m.id, "hello".into()).await.unwrap();

        assert_eq!(edited.content, b"hello");
        assert!(edited.edited_at > 0);
        assert_eq!(seq, 2);
        assert_eq!(
            t.svc.history(BOB, DM, None, 50).await.unwrap()[0].content,
            b"hello"
        );
        assert_eq!(t.pushes(BOB), ["created", "updated"]);
        assert_eq!(t.pushes(ALICE), ["created", "updated"]);
    }

    #[tokio::test]
    async fn only_the_author_can_edit_or_delete() {
        let t = setup();
        let m = t.send(ALICE, "mine").await;

        assert_eq!(
            code(
                t.svc
                    .edit(BOB, DM, m.id, "hacked".into())
                    .await
                    .unwrap_err()
            ),
            "not_your_message"
        );
        assert_eq!(
            code(t.svc.delete(BOB, DM, m.id).await.unwrap_err()),
            "not_your_message"
        );
        assert_eq!(
            code(t.svc.edit(EVE, DM, m.id, "x".into()).await.unwrap_err()),
            "conversation_not_found"
        );
        assert_eq!(
            code(t.svc.delete(EVE, DM, m.id).await.unwrap_err()),
            "conversation_not_found"
        );
        assert_eq!(t.repo.messages.lock().unwrap()[0].content, b"mine");
        assert_eq!(t.pushes(BOB), ["created"]);
    }

    #[tokio::test]
    async fn edit_checks_content_and_existence() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;

        assert_eq!(
            code(t.svc.edit(ALICE, DM, m.id, Vec::new()).await.unwrap_err()),
            "empty_message"
        );
        let huge = vec![b'a'; MAX_CONTENT_BYTES + 1];
        assert_eq!(
            code(t.svc.edit(ALICE, DM, m.id, huge).await.unwrap_err()),
            "message_too_long"
        );
        assert_eq!(
            code(t.svc.edit(ALICE, DM, 999, "x".into()).await.unwrap_err()),
            "message_not_found"
        );
    }

    #[tokio::test]
    async fn delete_removes_it_and_twice_is_fine() {
        let t = setup();
        let m = t.send(ALICE, "oops").await;

        assert_eq!(t.svc.delete(ALICE, DM, m.id).await.unwrap(), Some(2));
        assert!(t.svc.history(BOB, DM, None, 50).await.unwrap().is_empty());
        assert_eq!(t.pushes(BOB), ["created", "deleted"]);

        assert_eq!(t.svc.delete(ALICE, DM, m.id).await.unwrap(), None);
        assert_eq!(t.pushes(BOB), ["created", "deleted"]);
        assert_eq!(
            code(t.svc.edit(ALICE, DM, m.id, "x".into()).await.unwrap_err()),
            "message_not_found"
        );
    }

    #[tokio::test]
    async fn sync_reports_edits_and_deletes_of_older_messages() {
        let t = setup();
        let a = t.send(ALICE, "one").await;
        let b = t.send(BOB, "two").await;
        t.svc.edit(ALICE, DM, a.id, "one!".into()).await.unwrap();
        t.svc.delete(BOB, DM, b.id).await.unwrap();
        let c = t.send(ALICE, "three").await;

        let r = t.svc.sync(BOB, DM, 2).await.unwrap();

        assert!(r.complete);
        assert_eq!(r.messages.iter().map(|m| m.id).collect::<Vec<_>>(), [c.id]);
        assert_eq!(r.edited.len(), 1);
        assert_eq!(r.edited[0].content, b"one!");
        assert_eq!(r.deleted_ids, [b.id]);
        assert_eq!(r.last_seq, 5);

        let r = t.svc.sync(BOB, DM, 5).await.unwrap();
        assert!(r.messages.is_empty() && r.edited.is_empty() && r.deleted_ids.is_empty());
        assert_eq!(r.last_seq, 5);
    }

    #[tokio::test]
    async fn sync_folds_changes_to_the_same_message() {
        let t = setup();
        let a = t.send(ALICE, "v1").await;
        let new = t.send(ALICE, "new").await;
        t.svc.edit(ALICE, DM, a.id, "v2".into()).await.unwrap();
        t.svc.edit(ALICE, DM, a.id, "v3".into()).await.unwrap();
        t.svc.edit(ALICE, DM, new.id, "new!".into()).await.unwrap();

        let r = t.svc.sync(BOB, DM, 1).await.unwrap();

        assert_eq!(r.messages.len(), 1);
        assert_eq!(r.messages[0].content, b"new!");
        assert_eq!(r.edited.len(), 1);
        assert_eq!(r.edited[0].content, b"v3");

        t.svc.delete(ALICE, DM, a.id).await.unwrap();
        let r = t.svc.sync(BOB, DM, 2).await.unwrap();
        assert!(r.edited.iter().all(|m| m.id != a.id));
        assert_eq!(r.deleted_ids, [a.id]);
    }

    #[tokio::test]
    async fn send_retry_does_not_bring_back_a_deleted_message() {
        let t = setup();
        let m = t
            .svc
            .send(ALICE, DM, "oops".into(), &[], "retry-me")
            .await
            .unwrap();
        t.svc.delete(ALICE, DM, m.id).await.unwrap();

        let err = t
            .svc
            .send(ALICE, DM, "oops".into(), &[], "retry-me")
            .await
            .unwrap_err();

        assert_eq!(code(err), "message_not_found");
        assert!(t.repo.messages.lock().unwrap().is_empty());
        assert_eq!(t.pushes(BOB), ["created", "deleted"]);
    }

    #[tokio::test]
    async fn send_retry_still_returns_the_same_message() {
        let t = setup();
        let first = t
            .svc
            .send(ALICE, DM, "hi".into(), &[], "same")
            .await
            .unwrap();
        let again = t
            .svc
            .send(ALICE, DM, "hi".into(), &[], "same")
            .await
            .unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(t.repo.messages.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn sync_never_skips_a_seq_still_being_written() {
        let t = setup();
        t.send(ALICE, "one").await;
        t.conversations.next_seq(DM).await.unwrap();

        let r = t.svc.sync(BOB, DM, 0).await.unwrap();

        assert_eq!(r.last_seq, 1);
        let r = t.svc.sync(BOB, DM, 1).await.unwrap();
        assert_eq!(r.last_seq, 1);
        assert!(r.messages.is_empty());
    }

    #[tokio::test]
    async fn edit_that_loses_to_a_delete_leaves_no_change_row() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;
        t.svc.delete(ALICE, DM, m.id).await.unwrap();
        let stale = Message {
            content: b"late".to_vec(),
            ..m
        };
        assert!(!t.repo.edit(&stale, 99).await.unwrap());
        assert!(t.repo.changes.lock().unwrap().iter().all(|c| c.seq != 99));
    }
}
