use super::{NotificationPreferences, SettingsRepository, UpdateNotificationPreferences};
use crate::common::error::RepoError;

impl SettingsRepository {
    pub async fn get(&self, user_id: i64) -> Result<NotificationPreferences, RepoError> {
        Ok(sqlx::query_as(
            "SELECT COALESCE(p.messages, TRUE) AS messages, \
             COALESCE(p.incoming_calls, TRUE) AS incoming_calls, \
             COALESCE(p.friend_requests, TRUE) AS friend_requests \
             FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id \
             WHERE u.id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn update(
        &self,
        user_id: i64,
        changes: UpdateNotificationPreferences,
    ) -> Result<NotificationPreferences, RepoError> {
        Ok(sqlx::query_as(
            "INSERT INTO notification_preferences (user_id, messages, incoming_calls, friend_requests) \
             VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE)) \
             ON CONFLICT (user_id) DO UPDATE SET \
             messages = COALESCE($2, notification_preferences.messages), \
             incoming_calls = COALESCE($3, notification_preferences.incoming_calls), \
             friend_requests = COALESCE($4, notification_preferences.friend_requests) \
             RETURNING messages, incoming_calls, friend_requests",
        )
        .bind(user_id)
        .bind(changes.messages)
        .bind(changes.incoming_calls)
        .bind(changes.friend_requests)
        .fetch_one(&self.pool)
        .await?)
    }
}

impl SettingsRepository {
    pub async fn presence(
        &self,
        user_id: i64,
    ) -> Result<super::PresenceSettings, crate::common::error::ApiError> {
        let value: String =
            sqlx::query_scalar("SELECT presence_preference FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_one(&self.pool)
                .await
                .map_err(RepoError::from)?;
        let presence = serde_json::from_value(serde_json::Value::String(value))
            .map_err(|e| crate::common::error::ApiError::Internal(e.into()))?;
        Ok(super::PresenceSettings { presence })
    }

    pub async fn set_presence(
        &self,
        user_id: i64,
        presence: super::PresencePreference,
    ) -> Result<(), RepoError> {
        sqlx::query("UPDATE users SET presence_preference = $2 WHERE id = $1")
            .bind(user_id)
            .bind(presence.as_str())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn conversation(
        &self,
        user_id: i64,
        id: i64,
    ) -> Result<super::ConversationNotifications, crate::common::error::ApiError> {
        self.require_member(user_id, id).await?;
        let muted = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conversation_notification_preferences WHERE user_id = $1 AND conversation_id = $2)")
            .bind(user_id).bind(id).fetch_one(&self.pool).await.map_err(RepoError::from)?;
        Ok(super::ConversationNotifications { muted })
    }

    pub async fn set_conversation(
        &self,
        user_id: i64,
        id: i64,
        muted: bool,
    ) -> Result<(), crate::common::error::ApiError> {
        self.require_member(user_id, id).await?;
        if muted {
            sqlx::query("INSERT INTO conversation_notification_preferences (user_id, conversation_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
                .bind(user_id).bind(id).execute(&self.pool).await.map_err(RepoError::from)?;
        } else {
            sqlx::query("DELETE FROM conversation_notification_preferences WHERE user_id = $1 AND conversation_id = $2")
                .bind(user_id).bind(id).execute(&self.pool).await.map_err(RepoError::from)?;
        }
        Ok(())
    }

    async fn require_member(
        &self,
        user_id: i64,
        id: i64,
    ) -> Result<(), crate::common::error::ApiError> {
        self.conversations
            .get(id)
            .await?
            .filter(|c| c.member_ids.contains(&user_id))
            .ok_or(crate::common::error::ApiError::NotFound)?;
        Ok(())
    }
}
