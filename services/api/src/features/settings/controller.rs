use axum::{Json, extract::State};

use super::{NotificationPreferences, UpdateNotificationPreferences};
use crate::app::AppState;
use crate::common::{error::ApiError, middleware::auth::AuthUser};

pub async fn get_notifications(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<NotificationPreferences>, ApiError> {
    Ok(Json(state.settings.get(auth.user_id).await?))
}

pub async fn update_notifications(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(changes): Json<UpdateNotificationPreferences>,
) -> Result<Json<NotificationPreferences>, ApiError> {
    Ok(Json(state.settings.update(auth.user_id, changes).await?))
}

pub async fn get_presence(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<super::PresenceSettings>, ApiError> {
    Ok(Json(state.presence.preference(auth.user_id).await?))
}

pub async fn set_presence(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(settings): Json<super::PresenceSettings>,
) -> Result<Json<super::PresenceSettings>, ApiError> {
    Ok(Json(
        state
            .presence
            .set_preference(auth.user_id, settings.presence)
            .await?,
    ))
}

pub async fn get_conversation(
    auth: AuthUser,
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> Result<Json<super::ConversationNotifications>, ApiError> {
    Ok(Json(state.settings.conversation(auth.user_id, id).await?))
}

pub async fn set_conversation(
    auth: AuthUser,
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(settings): Json<super::ConversationNotifications>,
) -> Result<Json<super::ConversationNotifications>, ApiError> {
    state
        .settings
        .set_conversation(auth.user_id, id, settings.muted)
        .await?;
    Ok(Json(settings))
}
