use std::sync::Arc;

use anyhow::Context;
use scylla::client::session::Session;
use scylla::statement::prepared::PreparedStatement;

use protocol::Message as _;
use protocol::v1;

use super::queries as q;
use crate::common::error::RepoError;
use crate::common::scylla::lwt_applied;
use crate::features::messages::models::{Message, bucket_of};

pub struct ScyllaMessageRepo {
    pub(super) session: Arc<Session>,
    pub(super) claim_nonce: PreparedStatement,
    pub(super) get_nonce: PreparedStatement,
    pub(super) insert_message: PreparedStatement,
    insert_channel_message: PreparedStatement,
    pub(super) get_message: PreparedStatement,
    pub(super) history: PreparedStatement,
    pub(super) edit_message: PreparedStatement,
    pub(super) delete_message: PreparedStatement,
    pub(super) insert_change: PreparedStatement,
    pub(super) changes_since: PreparedStatement,
    pub(super) mark_deleted: PreparedStatement,
    pub(super) was_deleted: PreparedStatement,
}

pub(super) type Row = (
    i64,
    i64,
    Option<i64>,
    Option<i64>,
    Option<Vec<u8>>,
    Option<i8>,
    Option<i64>,
    Option<Vec<Vec<u8>>>,
);

impl ScyllaMessageRepo {
    pub async fn new(session: Arc<Session>) -> anyhow::Result<Self> {
        let prepare = |cql: &'static str| {
            let session = session.clone();
            async move {
                session
                    .prepare(cql)
                    .await
                    .with_context(|| format!("prepare: {cql}"))
            }
        };
        Ok(Self {
            claim_nonce: prepare(q::CLAIM_NONCE).await?,
            get_nonce: prepare(q::GET_NONCE).await?,
            insert_message: prepare(q::INSERT_MESSAGE).await?,
            insert_channel_message: prepare(
                "INSERT INTO messages (conversation_id, bucket, id, seq, author_id, content, encryption)
                 VALUES (?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS",
            )
            .await?,
            get_message: prepare(q::GET_MESSAGE).await?,
            history: prepare(q::HISTORY).await?,
            edit_message: prepare(q::EDIT_MESSAGE).await?,
            delete_message: prepare(q::DELETE_MESSAGE).await?,
            insert_change: prepare(q::INSERT_CHANGE).await?,
            changes_since: prepare(q::CHANGES_SINCE).await?,
            mark_deleted: prepare(q::MARK_DELETED).await?,
            was_deleted: prepare(q::WAS_DELETED).await?,
            session,
        })
    }
}

pub(super) fn to_message(
    (conversation_id, id, seq, author_id, content, encryption, edited_at, attachments): Row,
) -> Message {
    Message {
        id,
        conversation_id,
        author_id: author_id.unwrap_or(0),
        seq: seq.unwrap_or(0),
        content: content.unwrap_or_default(),
        encryption: encryption.unwrap_or(0),
        edited_at: edited_at.unwrap_or(0),
        attachments: attachments
            .unwrap_or_default()
            .iter()
            .filter_map(|b| match v1::Attachment::decode(b.as_slice()) {
                Ok(a) => Some(a.into()),
                Err(err) => {
                    tracing::warn!(error = %err, message.id = id, "bad attachment blob");
                    None
                }
            })
            .collect(),
    }
}

/// Each attachment as an encoded app.v1.Attachment (see 005_message_attachments.cql).
/// None for no attachments, so Scylla stores nothing.
pub(super) fn attachment_blobs(m: &Message) -> Option<Vec<Vec<u8>>> {
    (!m.attachments.is_empty()).then(|| {
        m.attachments
            .iter()
            .map(|a| {
                // WARN: preview links expire, so they are signed per response and never stored.
                let mut a = v1::Attachment::from(a);
                a.preview_url.clear();
                a.encode_to_vec()
            })
            .collect()
    })
}

#[async_trait::async_trait]
impl super::message_repo::ChannelMessageRepo for ScyllaMessageRepo {
    async fn insert_channel_message(&self, message: &Message) -> Result<bool, RepoError> {
        let rows = self
            .session
            .execute_unpaged(
                &self.insert_channel_message,
                (
                    message.conversation_id,
                    bucket_of(message.id),
                    message.id,
                    message.seq,
                    message.author_id,
                    &message.content,
                    message.encryption,
                ),
            )
            .await
            .context("insert channel message")?
            .into_rows_result()
            .context("insert channel message")?;
        Ok(lwt_applied(&rows).context("insert channel message")?)
    }
}
