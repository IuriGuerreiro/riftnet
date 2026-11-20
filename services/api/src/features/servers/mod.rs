pub mod channel_service;
mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use crate::app::AppState;
use axum::{
    Router,
    routing::{get, patch, post},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/servers", get(controller::list).post(controller::create))
        .route(
            "/servers/{server_id}/channels",
            get(controller::list_channels).post(controller::create_channel),
        )
        .route(
            "/servers/{server_id}/invite",
            post(controller::invite).delete(controller::revoke_invite),
        )
        .route(
            "/servers/{server_id}/channels/{channel_id}",
            patch(controller::rename_channel),
        )
        .route(
            "/servers/{server_id}/members",
            get(controller::list_members),
        )
        .route(
            "/servers/{server_id}/bans/{user_id}",
            post(controller::ban_member).delete(controller::unban_member),
        )
        .route("/servers/{server_id}/bans", get(controller::list_bans))
        .route("/servers/{server_id}/leave", post(controller::leave))
        .route("/servers/join", post(controller::join))
}
