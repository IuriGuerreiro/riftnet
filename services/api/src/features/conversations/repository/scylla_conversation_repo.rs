use std::sync::Arc;

use anyhow::Context;
use scylla::client::session::Session;
use scylla::statement::batch::{Batch, BatchType};
use scylla::statement::prepared::PreparedStatement;
use scylla::value::{CqlTimestamp, CqlValue};

use super::queries as q;
use crate::common::error::RepoError;
use crate::features::conversations::models::{ConversationRecord, Kind};

pub struct ScyllaConversationRepo {
    pub(super) session: Arc<Session>,
    pub(super) claim_dm_key: PreparedStatement,
    pub(super) get_dm_key: PreparedStatement,
    pub(super) insert_conversation: PreparedStatement,
    pub(super) insert_by_user: PreparedStatement,
    pub(super) get_conversation: PreparedStatement,
    pub(super) list_by_user: PreparedStatement,
    pub(super) bump_seq: PreparedStatement,
    pub(super) delete_by_user: PreparedStatement,
    pub(super) set_members: PreparedStatement,
    pub(super) rename: PreparedStatement,
    pub(super) bump_message_seq: PreparedStatement,
    pub(super) claim_group_nonce: PreparedStatement,
    pub(super) get_group_nonce: PreparedStatement,
    pub(super) list_read_states: PreparedStatement,
    pub(super) insert_read_state: PreparedStatement,
    pub(super) advance_read_state: PreparedStatement,
}

type Row = (
    i64,
    i8,
    Option<i64>,
    Option<Vec<i64>>,
    Option<String>,
    Option<i64>,
    Option<CqlTimestamp>,
);

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
            delete_by_user: prepare(q::DELETE_BY_USER).await?,
            set_members: prepare(q::SET_MEMBERS).await?,
            rename: prepare(q::RENAME).await?,
            bump_message_seq: prepare(q::BUMP_MESSAGE_SEQ).await?,
            claim_group_nonce: prepare(q::CLAIM_GROUP_NONCE).await?,
            get_group_nonce: prepare(q::GET_GROUP_NONCE).await?,
            list_read_states: prepare(q::LIST_READ_STATES).await?,
            insert_read_state: prepare(q::INSERT_READ_STATE).await?,
            advance_read_state: prepare(q::ADVANCE_READ_STATE).await?,
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

    pub(super) async fn write_conversation(
        &self,
        id: i64,
        kind: Kind,
        name: &str,
        members: &[i64],
    ) -> Result<(), RepoError> {
        let mut batch = Batch::new(BatchType::Logged);
        batch.append_statement(self.insert_conversation.clone());
        let mut values: Vec<Vec<CqlValue>> = vec![vec![
            CqlValue::BigInt(id),
            CqlValue::TinyInt(kind as i8),
            CqlValue::Text(name.to_string()),
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

fn to_record(
    (id, kind, last_seq, members, name, last_message_at, created_at): Row,
) -> ConversationRecord {
    let created_ms = created_at.map(|t| t.0).unwrap_or(0);
    ConversationRecord {
        last_message_at: last_message_at.unwrap_or(created_ms),
        id,
        kind: Kind::from_db(kind),
        last_seq: last_seq.unwrap_or(0),
        name: name.unwrap_or_default(),
        member_ids: members.unwrap_or_default(),
    }
}
