pub mod avatar;
mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, put};

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/me", get(controller::get_me).patch(controller::update_me))
        .route(
            "/me/avatar",
            put(controller::put_avatar)
                .layer(DefaultBodyLimit::max(avatar::MAX_AVATAR_BYTES))
                .delete(controller::delete_avatar),
        )
        .route("/users/{id}", get(controller::get_user))
        .route("/users/{id}/avatar/{hash}", get(controller::get_avatar))
        .route("/me/username", put(controller::set_username))
        .route("/users/search", get(controller::search_users))
}
