use std::sync::Arc;

use sqlx::PgPool;

use super::repository::PgSettingsRepository;
use super::{ConversationNotifications, NotificationPreferences, UpdateNotificationPreferences};
use crate::common::error::ApiError;
use crate::features::conversations::repository::ConversationRepo;

pub struct SettingsService {
    repo: PgSettingsRepository,
    conversations: Arc<dyn ConversationRepo>,
}

impl SettingsService {
    pub fn new(pool: PgPool, conversations: Arc<dyn ConversationRepo>) -> Self {
        Self {
            repo: PgSettingsRepository::new(pool),
            conversations,
        }
    }

    pub async fn get(&self, user_id: i64) -> Result<NotificationPreferences, ApiError> {
        Ok(self.repo.get(user_id).await?)
    }

    pub async fn update(
        &self,
        user_id: i64,
        changes: UpdateNotificationPreferences,
    ) -> Result<NotificationPreferences, ApiError> {
        Ok(self.repo.update(user_id, changes).await?)
    }

    pub async fn conversation(
        &self,
        user_id: i64,
        id: i64,
    ) -> Result<ConversationNotifications, ApiError> {
        self.require_member(user_id, id).await?;
        Ok(self.repo.conversation(user_id, id).await?)
    }

    pub async fn set_conversation(
        &self,
        user_id: i64,
        id: i64,
        muted: bool,
    ) -> Result<(), ApiError> {
        self.require_member(user_id, id).await?;
        Ok(self.repo.set_conversation(user_id, id, muted).await?)
    }

    async fn require_member(&self, user_id: i64, id: i64) -> Result<(), ApiError> {
        self.conversations
            .get(id)
            .await?
            .filter(|c| c.member_ids.contains(&user_id))
            .ok_or(ApiError::NotFound)?;
        Ok(())
    }
}
