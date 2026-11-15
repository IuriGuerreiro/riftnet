//! `ScyllaMessageRepo`: the struct, its prepared statements and helpers.
//! Its `MessageRepo` methods are in `message_repo.rs`. CQL is in `queries.rs`.

use std::sync::Arc;

use anyhow::Context;
use scylla::client::session::Session;
use scylla::statement::prepared::PreparedStatement;

use super::queries as q;
use crate::features::messages::models::Message;

pub struct ScyllaMessageRepo {
    pub(super) session: Arc<Session>,
    pub(super) claim_nonce: PreparedStatement,
    pub(super) get_nonce: PreparedStatement,
    pub(super) insert_message: PreparedStatement,
    pub(super) get_message: PreparedStatement,
    pub(super) history: PreparedStatement,
    pub(super) edit_message: PreparedStatement,
    pub(super) delete_message: PreparedStatement,
    pub(super) insert_change: PreparedStatement,
    pub(super) changes_since: PreparedStatement,
    pub(super) mark_deleted: PreparedStatement,
    pub(super) was_deleted: PreparedStatement,
}

/// Columns of `GET_MESSAGE` / `HISTORY`, in order.
pub(super) type Row = (
    i64,
    i64,
    Option<i64>,
    Option<i64>,
    Option<Vec<u8>>,
    Option<i8>,
    Option<i64>,
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
    (conversation_id, id, seq, author_id, content, encryption, edited_at): Row,
) -> Message {
    Message {
        id,
        conversation_id,
        author_id: author_id.unwrap_or(0),
        seq: seq.unwrap_or(0),
        content: content.unwrap_or_default(),
        encryption: encryption.unwrap_or(0),
        edited_at: edited_at.unwrap_or(0),
    }
}
