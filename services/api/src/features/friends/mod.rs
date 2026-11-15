//! Friends: requests, accept/decline/cancel, remove. HTTP routes; changes
//! are pushed live to both people's sockets as `FriendUpdated`.

mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use axum::Router;
use axum::routing::{delete, get, post};

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/friends", get(controller::list))
        .route("/friends/requests", post(controller::send_request))
        .route(
            "/friends/requests/{user_id}/accept",
            post(controller::accept),
        )
        .route(
            "/friends/requests/{user_id}",
            delete(controller::delete_request),
        )
        .route("/friends/{user_id}", delete(controller::remove_friend))
}
