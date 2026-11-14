//! WebSocket gateway. Every binary frame is one protobuf `Envelope`.
//!
//! - `controller.rs`: the HTTP → WebSocket upgrade
//! - `connection.rs`: one connected socket: authenticate, then the request loop

mod connection;
mod controller;

use axum::Router;
use axum::routing::get;

use crate::app::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/ws", get(controller::upgrade))
}
