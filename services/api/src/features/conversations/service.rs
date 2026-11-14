use std::collections::HashMap;
use std::sync::Arc;

use common::snowflake::Snowflake;

use protocol::Message as _;
use protocol::v1::{self, Envelope, envelope::Payload};

use super::models::{
    Conversation, ConversationRecord, Kind, MAX_GROUP_MEMBERS, MAX_GROUP_NAME_CHARS,
    MIN_GROUP_MEMBERS,
};
use super::repository::ConversationRepo;
use crate::common::error::ApiError;
use crate::common::events::EventBus;
use crate::features::users::models::User;
use crate::features::users::repository::UserRepo;
use crate::features::users::service::normalize_username;

pub struct ConversationService {
    repo: Arc<dyn ConversationRepo>,
    users: Arc<dyn UserRepo>,
    events: Arc<dyn EventBus>,
    ids: Arc<Snowflake>,
}

impl ConversationService {
    pub fn new(
        repo: Arc<dyn ConversationRepo>,
        users: Arc<dyn UserRepo>,
        events: Arc<dyn EventBus>,
        ids: Arc<Snowflake>,
    ) -> Self {
        Self {
            repo,
            users,
            events,
            ids,
        }
    }

    /// Opens the DM between `me` and `username` (creates it the first time).
    #[tracing::instrument(name = "conversations.open_dm", skip_all, fields(user.id = me))]
    pub async fn open_dm(&self, me: i64, username: &str) -> Result<Conversation, ApiError> {
        let other = self.find_user(username).await?;

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

    // --- group DMs ---

    /// New group with me + `usernames` (3-5 people in total).
    #[tracing::instrument(name = "conversations.create_group", skip_all, fields(user.id = me))]
    pub async fn create_group(
        &self,
        me: i64,
        name: &str,
        usernames: &[String],
    ) -> Result<Conversation, ApiError> {
        let name = clean_group_name(name)?;

        // Usernames → user ids. Me first, then the others in the order given.
        let mut member_ids = vec![me];
        for username in usernames {
            let user = self.find_user(username).await?;
            if !member_ids.contains(&user.id) {
                member_ids.push(user.id); // ignore duplicates (and me)
            }
        }
        if !(MIN_GROUP_MEMBERS..=MAX_GROUP_MEMBERS).contains(&member_ids.len()) {
            return Err(ApiError::bad_request(
                "bad_group_size",
                "a group has 3 to 5 people, including you",
            ));
        }

        let group = ConversationRecord {
            id: self.ids.next_id() as i64,
            kind: Kind::Group,
            last_seq: 0,
            name,
            member_ids,
        };
        self.repo.create_group(&group).await?;
        self.announce(&group, &group.member_ids).await
    }

    /// A member adds someone (max 5).
    #[tracing::instrument(name = "conversations.add_member", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn add_member(
        &self,
        me: i64,
        conversation_id: i64,
        username: &str,
    ) -> Result<Conversation, ApiError> {
        let new_user = self.find_user(username).await?;

        // Two people adding at once could make 6 members. `set_members` only
        // writes if the list didn't change since we read it; if it did, read
        // again and re-check.
        loop {
            let group = self.member_group(me, conversation_id).await?;

            if group.member_ids.contains(&new_user.id) {
                return self.announce(&group, &[]).await; // already in: nothing to do
            }

            if group.member_ids.len() >= MAX_GROUP_MEMBERS {
                return Err(ApiError::bad_request(
                    "group_full",
                    "a group has at most 5 people",
                ));
            }
            let mut new_members = group.member_ids.clone();
            new_members.push(new_user.id);

            if self
                .repo
                .set_members(conversation_id, &group.member_ids, &new_members)
                .await?
            {
                let group = ConversationRecord {
                    member_ids: new_members,
                    ..group
                };
                return self.announce(&group, &group.member_ids).await;
            }
        }
    }

    /// I leave. The others are told; my other devices drop it from the list.
    #[tracing::instrument(name = "conversations.leave_group", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn leave_group(&self, me: i64, conversation_id: i64) -> Result<(), ApiError> {
        loop {
            let group = self.member_group(me, conversation_id).await?;
            let new_members: Vec<i64> = group
                .member_ids
                .iter()
                .copied()
                .filter(|id| *id != me)
                .collect();

            if self
                .repo
                .set_members(conversation_id, &group.member_ids, &new_members)
                .await?
            {
                // Tell everyone, me included (the push shows I'm no longer a member).
                let notify = group.member_ids.clone();
                let group = ConversationRecord {
                    member_ids: new_members,
                    ..group
                };
                self.announce(&group, &notify).await?;
                return Ok(());
            }
        }
    }

    #[tracing::instrument(name = "conversations.rename_group", skip_all, fields(user.id = me, conversation.id = conversation_id))]
    pub async fn rename_group(
        &self,
        me: i64,
        conversation_id: i64,
        name: &str,
    ) -> Result<Conversation, ApiError> {
        let name = clean_group_name(name)?;
        let group = self.member_group(me, conversation_id).await?;
        self.repo.rename(conversation_id, &name).await?;
        let group = ConversationRecord { name, ..group };
        self.announce(&group, &group.member_ids).await
    }

    /// The group, if it is one and `me` is in it.
    async fn member_group(&self, me: i64, id: i64) -> Result<ConversationRecord, ApiError> {
        self.repo
            .get(id)
            .await?
            .filter(|c| c.kind == Kind::Group && c.member_ids.contains(&me))
            .ok_or_else(|| {
                ApiError::bad_request("conversation_not_found", "conversation not found")
            })
    }

    async fn find_user(&self, username: &str) -> Result<User, ApiError> {
        let not_found = || ApiError::bad_request("user_not_found", "no user with that username");
        let username = normalize_username(username).map_err(|_| not_found())?;
        self.users
            .find_by_username(&username)
            .await?
            .ok_or_else(not_found)
    }

    /// Adds profiles, then pushes `conversation_updated` to `notify` (live, all
    /// their devices). Like messages: saved first, so a failed push is only logged.
    async fn announce(
        &self,
        group: &ConversationRecord,
        notify: &[i64],
    ) -> Result<Conversation, ApiError> {
        let conversation = self.with_members(vec![group.clone()]).await?.remove(0);
        if !notify.is_empty() {
            let push = Envelope {
                id: 0,
                payload: Some(Payload::ConversationUpdated(v1::ConversationUpdated {
                    conversation: Some((&conversation).into()),
                })),
            };
            if let Err(err) = self
                .events
                .publish_to_users(notify, push.encode_to_vec().into())
                .await
            {
                tracing::warn!(error = %err, "conversation push failed");
            }
        }
        Ok(conversation)
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
                name: r.name,
                members: r
                    .member_ids
                    .iter()
                    .filter_map(|id| users.get(id).cloned())
                    .collect(),
            })
            .collect())
    }
}

/// Trimmed, 1-100 characters.
fn clean_group_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_GROUP_NAME_CHARS {
        return Err(ApiError::bad_request(
            "bad_group_name",
            "group name must be 1-100 characters",
        ));
    }
    Ok(name.to_string())
}
