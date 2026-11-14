//! Auth: register, login, refresh, logout. Zitadel checks passwords;
//! we issue our own tokens. See docs/architecture/identity-auth.md.

mod controller;
pub mod dto;
pub mod identity;
pub mod metrics;
pub mod models;
pub mod repository;
pub mod service;
pub mod tokens;

use axum::Router;
use axum::routing::post;

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(controller::register))
        .route("/auth/login", post(controller::login))
        .route("/auth/refresh", post(controller::refresh))
        .route("/auth/logout", post(controller::logout))
}
