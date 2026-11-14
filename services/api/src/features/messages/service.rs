use std::sync::Arc;

use common::snowflake::Snowflake;
use protocol::Message as _;
use protocol::v1::{Envelope, MessageCreated, envelope::Payload};

use super::models::{MAX_CONTENT_BYTES, MAX_NONCE_LEN, Message};
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

    /// Sends a message. Calling again with the same `nonce` (a retry after a
    /// network drop) returns the same message instead of a duplicate.
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

        // 1. Retry? Then the nonce already points at a message id.
        let (id, is_first_send) = self
            .repo
            .claim_nonce(conversation_id, me, nonce, self.ids.next_id() as i64)
            .await?;
        if !is_first_send && let Some(existing) = self.repo.get(conversation_id, id).await? {
            return Ok(existing);
        }
        // (A retry whose first attempt crashed before saving continues below
        // with the same id, so it still can't create a duplicate.)

        // 2. Next number in this conversation, then save.
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

        // 3. Live: push to every member's open sockets (including my other devices).
        //    The message is already saved, so if this fails, nobody loses it:
        //    they get it from history / sync. Just log it.
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

    /// Messages older than `before_id` (None = latest), newest first.
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

    /// The conversation, if `me` is in it. Same error whether it doesn't exist
    /// or you're not a member (don't reveal which conversations exist).
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
