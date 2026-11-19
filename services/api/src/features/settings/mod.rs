mod controller;
mod repository;

use std::sync::Arc;

use axum::{Router, routing::get};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::app::AppState;
use crate::features::conversations::repository::ConversationRepo;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct NotificationPreferences {
    pub messages: bool,
    pub incoming_calls: bool,
    pub friend_requests: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateNotificationPreferences {
    pub messages: Option<bool>,
    pub incoming_calls: Option<bool>,
    pub friend_requests: Option<bool>,
}

pub struct SettingsRepository {
    pool: PgPool,
    conversations: Arc<dyn ConversationRepo>,
}

impl SettingsRepository {
    pub fn new(pool: PgPool, conversations: Arc<dyn ConversationRepo>) -> Self {
        Self {
            pool,
            conversations,
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/me/settings/presence",
            get(controller::get_presence).put(controller::set_presence),
        )
        .route(
            "/me/settings/notifications/conversations/{id}",
            get(controller::get_conversation).put(controller::set_conversation),
        )
        .route(
            "/me/settings/notifications",
            get(controller::get_notifications).patch(controller::update_notifications),
        )
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PresencePreference {
    #[default]
    Online,
    Idle,
    DoNotDisturb,
    Invisible,
}

impl PresencePreference {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Idle => "idle",
            Self::DoNotDisturb => "do_not_disturb",
            Self::Invisible => "invisible",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PresenceSettings {
    pub presence: PresencePreference,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationNotifications {
    pub muted: bool,
}
