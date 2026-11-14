//! `ScyllaConversationRepo`: the struct, its prepared statements and helpers.
//! Its `ConversationRepo` methods are in `conversation_repo.rs`. CQL is in `queries.rs`.

use std::sync::Arc;

use anyhow::Context;
use scylla::client::session::Session;
use scylla::statement::batch::{Batch, BatchType};
use scylla::statement::prepared::PreparedStatement;
use scylla::value::{CqlTimestamp, CqlValue};

use super::queries as q;
use crate::common::error::RepoError;
use crate::features::conversations::models::{ConversationRecord, Kind};

/// Statements are "prepared" once at startup: Scylla parses them a single
/// time, then each call only sends the values. Faster, and no CQL injection.
pub struct ScyllaConversationRepo {
    pub(super) session: Arc<Session>,
    pub(super) claim_dm_key: PreparedStatement,
    pub(super) get_dm_key: PreparedStatement,
    pub(super) insert_conversation: PreparedStatement,
    pub(super) insert_by_user: PreparedStatement,
    pub(super) get_conversation: PreparedStatement,
    pub(super) list_by_user: PreparedStatement,
    pub(super) bump_seq: PreparedStatement,
}

/// Columns of `GET_CONVERSATION`, in order.
type Row = (i64, i8, Option<i64>, Option<Vec<i64>>);

impl ScyllaConversationRepo {
    pub async fn new(session: Arc<Session>) -> anyhow::Result<Self> {
        let prepare = |cql: &'static str| {
            let session = session.clone();
            async move { session.prepare(cql).await }
        };
        Ok(Self {
            claim_dm_key: prepare(q::CLAIM_DM_KEY).await?,
            get_dm_key: prepare(q::GET_DM_KEY).await?,
            insert_conversation: prepare(q::INSERT_CONVERSATION).await?,
            insert_by_user: prepare(q::INSERT_BY_USER).await?,
            get_conversation: prepare(q::GET_CONVERSATION).await?,
            list_by_user: prepare(q::LIST_BY_USER).await?,
            bump_seq: prepare(q::BUMP_SEQ).await?,
            session,
        })
    }

    pub(super) async fn get_by_id(&self, id: i64) -> Result<Option<ConversationRecord>, RepoError> {
        let rows = self
            .session
            .execute_unpaged(&self.get_conversation, (id,))
            .await
            .context("get conversation")?
            .into_rows_result()
            .context("get conversation")?;

        let row = rows.maybe_first_row::<Row>().context("get conversation")?;
        Ok(row.map(to_record))
    }

    /// Writes a new conversation: its row + one `conversations_by_user` row per
    /// member (so it shows up in each member's list).
    ///
    /// All in one LOGGED batch: Scylla first records "about to do these", then
    /// does them, and finishes the rest itself if anything dies midway.
    /// `values[i]` fills the `?`s of the i-th statement added to the batch.
    pub(super) async fn write_conversation(
        &self,
        id: i64,
        kind: Kind,
        members: &[i64],
    ) -> Result<(), RepoError> {
        let mut batch = Batch::new(BatchType::Logged);
        batch.append_statement(self.insert_conversation.clone());
        let mut values: Vec<Vec<CqlValue>> = vec![vec![
            CqlValue::BigInt(id),
            CqlValue::TinyInt(kind as i8),
            CqlValue::List(members.iter().map(|m| CqlValue::BigInt(*m)).collect()),
            CqlValue::Timestamp(CqlTimestamp(chrono::Utc::now().timestamp_millis())),
        ]];
        for member in members {
            batch.append_statement(self.insert_by_user.clone());
            values.push(vec![CqlValue::BigInt(*member), CqlValue::BigInt(id)]);
        }
        self.session
            .batch(&batch, values)
            .await
            .context("write conversation")?;
        Ok(())
    }
}

fn to_record((id, kind, last_seq, members): Row) -> ConversationRecord {
    ConversationRecord {
        id,
        kind: Kind::from_db(kind),
        last_seq: last_seq.unwrap_or(0),
        member_ids: members.unwrap_or_default(),
    }
}
