mod controller;
mod repository;
mod service;
pub use service::SettingsService;

use axum::{Router, routing::get};
use serde::{Deserialize, Serialize};

use crate::app::AppState;

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

pub use crate::features::presence::models::PresencePreference;

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
