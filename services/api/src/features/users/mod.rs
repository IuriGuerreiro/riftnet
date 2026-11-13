//! Users: profile of the logged-in user, picking a username.

mod controller;
pub mod dto;
pub mod models;
pub mod repository;
pub mod service;

use axum::Router;
use axum::routing::{get, put};

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/me", get(controller::get_me))
        .route("/me/username", put(controller::set_username))
}
