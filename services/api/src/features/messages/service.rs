use std::sync::Arc;

use common::snowflake::Snowflake;
use protocol::Message as _;
use protocol::v1::{Envelope, MessageCreated, envelope::Payload};

use super::models::{MAX_CONTENT_BYTES, MAX_NONCE_LEN, MAX_SYNC, Message};
use super::repository::MessageRepo;
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::conversations::models::ConversationRecord;
use crate::features::conversations::repository::ConversationRepo;

pub struct MessageService {
    repo: Arc<dyn MessageRepo>,
    conversations: Arc<dyn ConversationRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
}

impl MessageService {
    pub fn new(
        repo: Arc<dyn MessageRepo>,
        conversations: Arc<dyn ConversationRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self {
            repo,
            conversations,
            events,
            ids,
        }
    }

    #[tracing::instrument(name = "messages.send", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn send(
        &self,
        me: i64,
        conversation_id: i64,
        content: Vec<u8>,
        nonce: &str,
    ) -> Result<Message, ApiError> {
        if content.is_empty() {
            return Err(ApiError::bad_request("empty_message", "message is empty"));
        }
        if content.len() > MAX_CONTENT_BYTES {
            return Err(ApiError::bad_request(
                "message_too_long",
                "message is too long",
            ));
        }
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
        if !is_first_send && let Some(existing) = self.repo.get(conversation_id, id).await? {
            return Ok(existing);
        }

        let seq = self.conversations.next_seq(conversation_id).await?;
        let message = Message {
            id,
            conversation_id,
            author_id: me,
            seq,
            content,
            encryption: 0,
        };
        self.repo.insert(&message).await?;

        let push = Envelope {
            id: 0,
            payload: Some(Payload::MessageCreated(MessageCreated {
                message: Some((&message).into()),
            })),
        };
        if let Err(err) = self
            .events
            .publish_to_users(&conversation.member_ids, push.encode_to_vec().into())
            .await
        {
            tracing::warn!(error = %err, "live delivery failed");
        }
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
        Ok(self
            .repo
            .history(conversation_id, before_id, limit, conversation.id)
            .await?)
    }

    #[tracing::instrument(name = "messages.sync", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn sync(
        &self,
        me: i64,
        conversation_id: i64,
        after_seq: i64,
    ) -> Result<(Vec<Message>, bool), ApiError> {
        let conversation = self.member_conversation(me, conversation_id).await?;
        if conversation.last_seq <= after_seq {
            return Ok((Vec::new(), true));
        }
        let mut messages = self
            .repo
            .since_seq(conversation_id, after_seq, MAX_SYNC + 1, conversation.id)
            .await?;
        let complete = messages.len() <= MAX_SYNC;
        messages.truncate(MAX_SYNC);
        messages.reverse();
        Ok((messages, complete))
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
