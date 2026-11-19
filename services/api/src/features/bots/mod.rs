mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use axum::Router;
use axum::routing::{delete, get};

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/bots",
            get(controller::list_bots).post(controller::create_bot),
        )
        .route(
            "/bots/{bot_id}/keys",
            get(controller::list_keys).post(controller::issue_key),
        )
        .route(
            "/bots/{bot_id}/keys/{key_id}",
            delete(controller::revoke_key),
        )
        .route("/bot/me", get(controller::bot_me))
}
