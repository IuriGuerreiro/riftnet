use std::collections::HashMap;
use std::sync::Arc;

use common::snowflake::Snowflake;

use super::models::{Conversation, ConversationRecord};
use super::repository::ConversationRepo;
use crate::common::error::ApiError;
use crate::features::users::repository::UserRepo;
use crate::features::users::service::normalize_username;

pub struct ConversationService {
    repo: Arc<dyn ConversationRepo>,
    users: Arc<dyn UserRepo>,
    ids: Arc<Snowflake>,
}

impl ConversationService {
    pub fn new(
        repo: Arc<dyn ConversationRepo>,
        users: Arc<dyn UserRepo>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self { repo, users, ids }
    }

    /// Opens the DM between `me` and `username` (creates it the first time).
    #[tracing::instrument(name = "conversations.open_dm", skip_all, fields(user.id = me))]
    pub async fn open_dm(&self, me: i64, username: &str) -> Result<Conversation, ApiError> {
        let not_found = || ApiError::bad_request("user_not_found", "no user with that username");
        let username = normalize_username(username).map_err(|_| not_found())?;

        let other = self
            .users
            .find_by_username(&username)
            .await?
            .ok_or_else(not_found)?;

        if other.id == me {
            return Err(ApiError::bad_request(
                "cannot_dm_self",
                "you can't DM yourself",
            ));
        }

        let record = self
            .repo
            .get_or_create_dm(self.ids.next_id() as i64, me, other.id)
            .await?;

        Ok(self.with_members(vec![record]).await?.remove(0))
    }

    #[tracing::instrument(name = "conversations.list", skip_all, fields(user.id = me))]
    pub async fn list(&self, me: i64) -> Result<Vec<Conversation>, ApiError> {
        let records = self.repo.list_for_user(me).await?;
        self.with_members(records).await
    }

    /// Records only hold member ids; look up their profiles in one query.
    async fn with_members(
        &self,
        records: Vec<ConversationRecord>,
    ) -> Result<Vec<Conversation>, ApiError> {
        let mut ids: Vec<i64> = records
            .iter()
            .flat_map(|r| r.member_ids.iter().copied())
            .collect();

        ids.sort_unstable();
        ids.dedup();
        let users: HashMap<i64, _> = self
            .users
            .find_by_ids(&ids)
            .await?
            .into_iter()
            .map(|u| (u.id, u))
            .collect();

        Ok(records
            .into_iter()
            .map(|r| Conversation {
                id: r.id,
                kind: r.kind,
                last_seq: r.last_seq,
                members: r
                    .member_ids
                    .iter()
                    .filter_map(|id| users.get(id).cloned())
                    .collect(),
            })
            .collect())
    }
}
