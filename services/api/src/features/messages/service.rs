use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::snowflake::Snowflake;
use protocol::Message as _;
use protocol::v1::{
    Envelope, MessageCreated, MessageDeleted, MessageUpdated, ReactionUpdated, envelope::Payload,
};

use super::models::{
    ChangeKind, MAX_CONTENT_BYTES, MAX_DISTINCT_REACTIONS, MAX_NONCE_LEN, MAX_REACTORS, MAX_SYNC,
    Message, ReactionCount, count_reactions, is_valid_emoji,
};
use super::repository::{MessageRepo, ReactionRepo};
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

pub const REACTION_LIMIT: u32 = 10;
pub const REACTION_WINDOW: Duration = Duration::from_secs(10);

pub struct MessageService {
    repo: Arc<dyn MessageRepo>,
    reactions: Arc<dyn ReactionRepo>,
    /// user id -> (window start, changes in window)
    reaction_rate: Mutex<HashMap<i64, (Instant, u32)>>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
    attachments: Arc<dyn AttachmentLinker>,
}

impl MessageService {
    pub fn new(
        repo: Arc<dyn MessageRepo>,
        reactions: Arc<dyn ReactionRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
        attachments: Arc<dyn AttachmentLinker>,
    ) -> Self {
        Self {
            repo,
            reactions,
            reaction_rate: Mutex::new(HashMap::new()),
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
        reply_to: i64,
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

        // The original must exist and be in this conversation. The lookup is
        // scoped to the conversation, so another conversation's id is just "not found".
        if reply_to != 0 && self.repo.get(conversation_id, reply_to).await?.is_none() {
            return Err(ApiError::bad_request(
                "bad_reply",
                "the replied-to message is not in this conversation",
            ));
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
            reply_to,
            reactions: Vec::new(),
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
        self.fill_reactions(me, conversation_id, &mut messages)
            .await?;
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
            self.fill_reactions(me, conversation_id, &mut messages)
                .await?;
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
                ChangeKind::Edit | ChangeKind::Reaction
                    if messages.iter().any(|m| m.id == change.message_id) => {}
                ChangeKind::Edit | ChangeKind::Reaction => {
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
        self.fill_reactions(me, conversation_id, &mut messages)
            .await?;
        self.fill_reactions(me, conversation_id, &mut result.edited)
            .await?;
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

    /// Adds or removes my reaction. Returns the message's reactions now and
    /// the change's seq (0 = nothing changed).
    #[tracing::instrument(name = "messages.react", skip_all, fields(user.id = me, conversation.id = conversation_id, added = add))]
    pub async fn react(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        add: bool,
    ) -> Result<(Vec<ReactionCount>, i64), ApiError> {
        self.react_at(me, conversation_id, message_id, emoji, add, Instant::now())
            .await
    }

    async fn react_at(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
        add: bool,
        now: Instant,
    ) -> Result<(Vec<ReactionCount>, i64), ApiError> {
        if !is_valid_emoji(emoji) {
            return Err(ApiError::bad_request("bad_emoji", "not an emoji"));
        }
        let conversation = self.member_conversation(me, conversation_id).await?;
        if !self.reaction_allowed(me, now) {
            return Err(ApiError::TooManyRequests);
        }
        if self.repo.get(conversation_id, message_id).await?.is_none() {
            return Err(message_not_found());
        }
        let before = self
            .reactions
            .for_messages(conversation_id, &[message_id])
            .await?;
        if add
            && !before.iter().any(|r| r.emoji == emoji)
            && count_reactions(&before, me).len() >= MAX_DISTINCT_REACTIONS
        {
            return Err(ApiError::bad_request(
                "too_many_reactions",
                "this message has too many different reactions",
            ));
        }

        let changed = if add {
            self.reactions
                .add(conversation_id, message_id, emoji, me)
                .await?
        } else {
            self.reactions
                .remove(conversation_id, message_id, emoji, me)
                .await?
        };
        let rows = self
            .reactions
            .for_messages(conversation_id, &[message_id])
            .await?;
        let now_counts = count_reactions(&rows, me);
        if !changed {
            return Ok((now_counts, 0));
        }

        let seq = self.conversations.next_seq(conversation_id).await?;
        self.repo
            .log_reaction(conversation_id, message_id, seq)
            .await?;
        let count = now_counts
            .iter()
            .find(|c| c.emoji == emoji)
            .map_or(0, |c| c.count);
        let push = Payload::ReactionUpdated(ReactionUpdated {
            conversation_id: conversation_id as u64,
            message_id: message_id as u64,
            emoji: emoji.to_string(),
            user_id: me as u64,
            added: add,
            count,
            seq: seq as u64,
        });
        self.push(&conversation.member_ids, push).await;
        Ok((now_counts, seq))
    }

    /// Who reacted with `emoji`, oldest row order, max 100.
    #[tracing::instrument(name = "messages.reactors", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn reactors(
        &self,
        me: i64,
        conversation_id: i64,
        message_id: i64,
        emoji: &str,
    ) -> Result<Vec<i64>, ApiError> {
        self.member_conversation(me, conversation_id).await?;
        let rows = self
            .reactions
            .for_messages(conversation_id, &[message_id])
            .await?;
        Ok(rows
            .into_iter()
            .filter(|r| r.emoji == emoji)
            .map(|r| r.user_id)
            .take(MAX_REACTORS)
            .collect())
    }

    async fn fill_reactions(
        &self,
        me: i64,
        conversation_id: i64,
        messages: &mut [Message],
    ) -> Result<(), ApiError> {
        let ids: Vec<i64> = messages.iter().map(|m| m.id).collect();
        let rows = self.reactions.for_messages(conversation_id, &ids).await?;
        for m in messages.iter_mut() {
            m.reactions = count_reactions(rows.iter().filter(|r| r.message_id == m.id), me);
        }
        Ok(())
    }

    fn reaction_allowed(&self, me: i64, now: Instant) -> bool {
        let mut rate = self.reaction_rate.lock().expect("reaction mutex poisoned");
        if rate.len() > 10_000 {
            rate.retain(|_, (start, _)| now.saturating_duration_since(*start) < REACTION_WINDOW);
        }
        let entry = rate.entry(me).or_insert((now, 0));
        if now.saturating_duration_since(entry.0) >= REACTION_WINDOW {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= REACTION_LIMIT
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
    use crate::features::messages::models::{MessageChange, ReactionRow};

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
        async fn get(&self, conversation_id: i64, id: i64) -> Result<Option<Message>, RepoError> {
            Ok(self
                .messages
                .lock()
                .unwrap()
                .iter()
                .find(|m| m.id == id && m.conversation_id == conversation_id)
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
        async fn log_reaction(&self, _: i64, id: i64, change_seq: i64) -> Result<(), RepoError> {
            self.changes.lock().unwrap().push(MessageChange {
                seq: change_seq,
                message_id: id,
                kind: ChangeKind::Reaction,
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
    struct FakeReactions {
        rows: Mutex<Vec<ReactionRow>>,
    }
    #[async_trait]
    impl ReactionRepo for FakeReactions {
        async fn add(
            &self,
            _: i64,
            message_id: i64,
            emoji: &str,
            user_id: i64,
        ) -> Result<bool, RepoError> {
            let row = ReactionRow {
                message_id,
                emoji: emoji.into(),
                user_id,
            };
            let mut rows = self.rows.lock().unwrap();
            if rows.contains(&row) {
                return Ok(false);
            }
            rows.push(row);
            Ok(true)
        }
        async fn remove(
            &self,
            _: i64,
            message_id: i64,
            emoji: &str,
            user_id: i64,
        ) -> Result<bool, RepoError> {
            let mut rows = self.rows.lock().unwrap();
            let before = rows.len();
            rows.retain(|r| {
                !(r.message_id == message_id && r.emoji == emoji && r.user_id == user_id)
            });
            Ok(rows.len() != before)
        }
        async fn for_messages(&self, _: i64, ids: &[i64]) -> Result<Vec<ReactionRow>, RepoError> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .filter(|r| ids.contains(&r.message_id))
                .cloned()
                .collect())
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
                Some(Payload::ReactionUpdated(_)) => "reaction",
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
            Arc::new(FakeReactions::default()),
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
                .send(from, DM, text.into(), &[], 0, &nonce)
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
            .send(ALICE, DM, "oops".into(), &[], 0, "retry-me")
            .await
            .unwrap();
        t.svc.delete(ALICE, DM, m.id).await.unwrap();

        let err = t
            .svc
            .send(ALICE, DM, "oops".into(), &[], 0, "retry-me")
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
            .send(ALICE, DM, "hi".into(), &[], 0, "same")
            .await
            .unwrap();
        let again = t
            .svc
            .send(ALICE, DM, "hi".into(), &[], 0, "same")
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

    const THUMBS: &str = "👍";

    #[tokio::test]
    async fn reacting_counts_marks_me_and_pushes_to_everyone() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;

        let (counts, seq) = t.svc.react(BOB, DM, m.id, THUMBS, true).await.unwrap();
        assert_eq!(seq, 2);
        assert_eq!(
            counts,
            [ReactionCount {
                emoji: THUMBS.into(),
                count: 1,
                me: true
            }]
        );
        t.svc.react(ALICE, DM, m.id, THUMBS, true).await.unwrap();

        let h = t.svc.history(ALICE, DM, None, 50).await.unwrap();
        assert_eq!(
            h[0].reactions,
            [ReactionCount {
                emoji: THUMBS.into(),
                count: 2,
                me: true
            }]
        );
        assert_eq!(t.pushes(ALICE), ["created", "reaction", "reaction"]);
        assert_eq!(t.pushes(BOB), ["created", "reaction", "reaction"]);
        assert_eq!(
            t.svc.reactors(ALICE, DM, m.id, THUMBS).await.unwrap(),
            [BOB, ALICE]
        );
    }

    #[tokio::test]
    async fn reacting_twice_or_removing_nothing_is_a_no_op() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;
        t.svc.react(BOB, DM, m.id, THUMBS, true).await.unwrap();

        let (counts, seq) = t.svc.react(BOB, DM, m.id, THUMBS, true).await.unwrap();
        assert_eq!((counts[0].count, seq), (1, 0));
        let (_, seq) = t.svc.react(ALICE, DM, m.id, THUMBS, false).await.unwrap();
        assert_eq!(seq, 0);
        let (counts, seq) = t.svc.react(BOB, DM, m.id, THUMBS, false).await.unwrap();
        assert!(counts.is_empty() && seq > 0);
        assert_eq!(t.pushes(ALICE), ["created", "reaction", "reaction"]);
    }

    #[tokio::test]
    async fn reactions_check_membership_emoji_and_message() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;
        assert_eq!(
            code(t.svc.react(EVE, DM, m.id, THUMBS, true).await.unwrap_err()),
            "conversation_not_found"
        );
        assert_eq!(
            code(t.svc.reactors(EVE, DM, m.id, THUMBS).await.unwrap_err()),
            "conversation_not_found"
        );
        for bad in ["", "a", "lol", " 👍", "👍👍👍👍👍👍👍👍👍"] {
            assert_eq!(
                code(t.svc.react(BOB, DM, m.id, bad, true).await.unwrap_err()),
                "bad_emoji",
                "{bad:?}"
            );
        }
        assert_eq!(
            code(t.svc.react(BOB, DM, 999, THUMBS, true).await.unwrap_err()),
            "message_not_found"
        );
    }

    #[tokio::test]
    async fn distinct_emojis_are_capped_but_joining_one_still_works() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;
        let emojis: Vec<String> = (0..MAX_DISTINCT_REACTIONS as u32)
            .map(|i| char::from_u32(0x1F600 + i).unwrap().to_string())
            .collect();
        let start = Instant::now();
        for (i, e) in emojis.iter().enumerate() {
            let at = start + REACTION_WINDOW * i as u32;
            t.svc.react_at(ALICE, DM, m.id, e, true, at).await.unwrap();
        }
        let later = start + REACTION_WINDOW * 100;
        assert_eq!(
            code(
                t.svc
                    .react_at(BOB, DM, m.id, "🦀", true, later)
                    .await
                    .unwrap_err()
            ),
            "too_many_reactions"
        );
        let (counts, _) = t
            .svc
            .react_at(BOB, DM, m.id, &emojis[0], true, later)
            .await
            .unwrap();
        assert_eq!(counts[0].count, 2);
    }

    #[tokio::test]
    async fn reactions_are_rate_limited_per_user() {
        let t = setup();
        let m = t.send(ALICE, "hi").await;
        let now = Instant::now();
        for i in 0..REACTION_LIMIT {
            t.svc
                .react_at(BOB, DM, m.id, THUMBS, i % 2 == 0, now)
                .await
                .unwrap();
        }
        let err = t
            .svc
            .react_at(BOB, DM, m.id, THUMBS, true, now)
            .await
            .unwrap_err();
        assert!(matches!(err, ApiError::TooManyRequests));
        t.svc
            .react_at(ALICE, DM, m.id, THUMBS, true, now)
            .await
            .unwrap();
        t.svc
            .react_at(BOB, DM, m.id, THUMBS, true, now + REACTION_WINDOW)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn sync_reports_reaction_changes_on_older_messages() {
        let t = setup();
        let a = t.send(ALICE, "old").await;
        t.svc.react(BOB, DM, a.id, THUMBS, true).await.unwrap();

        let r = t.svc.sync(ALICE, DM, 1).await.unwrap();

        assert!(r.messages.is_empty());
        assert_eq!(r.edited.len(), 1);
        assert_eq!(
            r.edited[0].reactions,
            [ReactionCount {
                emoji: THUMBS.into(),
                count: 1,
                me: false
            }]
        );
        assert_eq!(r.last_seq, 2);
    }

    #[tokio::test]
    async fn deleting_a_message_blocks_new_reactions() {
        let t = setup();
        let m = t.send(ALICE, "bye").await;
        t.svc.delete(ALICE, DM, m.id).await.unwrap();
        assert_eq!(
            code(t.svc.react(BOB, DM, m.id, THUMBS, true).await.unwrap_err()),
            "message_not_found"
        );
    }

    #[tokio::test]
    async fn reply_is_stored_and_returned_everywhere() {
        let t = setup();
        let original = t.send(ALICE, "question").await;
        let reply = t
            .svc
            .send(BOB, DM, "answer".into(), &[], original.id, "r1")
            .await
            .unwrap();

        assert_eq!(reply.reply_to, original.id);
        assert_eq!(
            t.svc.history(ALICE, DM, None, 50).await.unwrap()[0].reply_to,
            original.id
        );
        assert_eq!(
            protocol::v1::Message::from(&reply).reply_to,
            original.id as u64
        );
    }

    #[tokio::test]
    async fn reply_to_unknown_or_other_conversation_is_rejected() {
        let t = setup();
        let elsewhere = Message {
            conversation_id: 200,
            ..t.send(ALICE, "other room").await
        };
        t.repo.messages.lock().unwrap().push(Message {
            id: 999,
            ..elsewhere
        });

        for target in [999, 12345] {
            let err = t
                .svc
                .send(ALICE, DM, "hi".into(), &[], target, &format!("n{target}"))
                .await
                .unwrap_err();
            assert_eq!(code(err), "bad_reply");
        }
    }

    #[tokio::test]
    async fn reply_keeps_its_link_after_the_original_is_deleted() {
        let t = setup();
        let original = t.send(ALICE, "gone soon").await;
        t.svc
            .send(BOB, DM, "re".into(), &[], original.id, "r1")
            .await
            .unwrap();
        t.svc.delete(ALICE, DM, original.id).await.unwrap();

        let history = t.svc.history(BOB, DM, None, 50).await.unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].reply_to, original.id);
    }
}
