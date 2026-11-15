mod connection;
mod controller;
mod handlers;

use axum::Router;
use axum::routing::get;

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/ws", get(controller::upgrade))
}
