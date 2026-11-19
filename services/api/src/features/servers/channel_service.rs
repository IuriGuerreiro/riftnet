use std::collections::HashMap;
use std::sync::Arc;

use super::repository::ServerRepo;
use crate::features::messages::repository::ChannelMessageRepo;
use common::snowflake::{Snowflake, timestamp_ms};
use protocol::Message as _;
use protocol::v1::{self, envelope::Payload};

use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::messages::models::{MAX_CONTENT_BYTES, MAX_NONCE_LEN, Message};

const PAGE_SIZE: usize = 50;

pub struct ChannelMessageService {
    servers: Arc<dyn ServerRepo>,
    repo: Arc<dyn ChannelMessageRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
}

impl ChannelMessageService {
    pub fn new(
        servers: Arc<dyn ServerRepo>,
        repo: Arc<dyn ChannelMessageRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self {
            servers,
            repo,
            events,
            ids,
        }
    }

    pub async fn history(
        &self,
        user_id: i64,
        req: v1::GetChannelHistory,
    ) -> Result<v1::ChannelHistory, ApiError> {
        let channel_id = i64::try_from(req.channel_id).map_err(|_| ApiError::NotFound)?;
        self.servers
            .member_server(user_id, channel_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        let before_id = match req.before_id {
            0 => None,
            id => Some(
                i64::try_from(id)
                    .map_err(|_| ApiError::bad_request("bad_cursor", "Invalid message cursor"))?,
            ),
        };
        // A future cursor must not turn into a scan through future Scylla buckets.
        if before_id.is_some_and(|id| {
            timestamp_ms(id as u64) > chrono::Utc::now().timestamp_millis() as u64 + 60_000
        }) {
            return Err(ApiError::bad_request(
                "bad_cursor",
                "Invalid message cursor",
            ));
        }
        let mut rows = self
            .repo
            .history(channel_id, before_id, PAGE_SIZE + 1, channel_id)
            .await?;
        let next_before_id = if rows.len() > PAGE_SIZE {
            rows.truncate(PAGE_SIZE);
            rows.last().map_or(0, |message| message.id as u64)
        } else {
            0
        };
        let authors = rows
            .iter()
            .map(|message| message.author_id)
            .collect::<Vec<_>>();
        let names = self.servers.author_names(&authors).await?;
        Ok(v1::ChannelHistory {
            next_before_id,
            messages: rows
                .into_iter()
                .map(|message| to_channel_message(message, &names))
                .collect(),
        })
    }

    pub async fn send(
        &self,
        user_id: i64,
        req: v1::SendChannelMessage,
    ) -> Result<v1::ChannelMessage, ApiError> {
        let channel_id = i64::try_from(req.channel_id).map_err(|_| ApiError::NotFound)?;
        let server_id = self
            .servers
            .member_server(user_id, channel_id)
            .await?
            .ok_or(ApiError::NotFound)?;
        let text = req.text.trim();
        if text.is_empty() || text.len() > MAX_CONTENT_BYTES {
            return Err(ApiError::bad_request(
                "invalid_message",
                "Message must be 1–8192 bytes",
            ));
        }
        if req.nonce.is_empty() || req.nonce.len() > MAX_NONCE_LEN {
            return Err(ApiError::bad_request(
                "bad_nonce",
                "Nonce must be 1–64 bytes",
            ));
        }

        let names = self.servers.author_names(&[user_id]).await?;
        let (id, first) = self
            .repo
            .claim_nonce(channel_id, user_id, &req.nonce, self.ids.next_id() as i64)
            .await?;
        if !first && let Some(message) = self.repo.get(channel_id, id).await? {
            return Ok(to_channel_message(message, &names));
        }
        let message = Message {
            id,
            conversation_id: channel_id,
            author_id: user_id,
            seq: id,
            content: text.as_bytes().to_vec(),
            encryption: 0,
            edited_at: 0,
            attachments: Vec::new(),
        };
        if !self.repo.insert_channel_message(&message).await? {
            let existing = self.repo.get(channel_id, id).await?.ok_or_else(|| {
                ApiError::Internal(anyhow::anyhow!(
                    "channel message missing after concurrent insert"
                ))
            })?;
            return Ok(to_channel_message(existing, &names));
        }

        let message = to_channel_message(message, &names);
        if let Err(error) = self.publish(server_id, &message).await {
            tracing::warn!(%error, channel.id = channel_id, "channel message live delivery failed");
        }
        Ok(message)
    }

    async fn publish(&self, server_id: i64, message: &v1::ChannelMessage) -> anyhow::Result<()> {
        let members = self.servers.member_ids(server_id).await?;
        let envelope = v1::Envelope {
            id: 0,
            payload: Some(Payload::ChannelMessage(message.clone())),
        };
        self.events
            .publish_to_users(&members, envelope.encode_to_vec().into())
            .await
    }
}

fn to_channel_message(message: Message, names: &HashMap<i64, String>) -> v1::ChannelMessage {
    v1::ChannelMessage {
        id: message.id as u64,
        channel_id: message.conversation_id as u64,
        author_id: message.author_id as u64,
        author_name: names
            .get(&message.author_id)
            .cloned()
            .unwrap_or_else(|| "Unknown user".into()),
        text: String::from_utf8_lossy(&message.content).into_owned(),
    }
}
