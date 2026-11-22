use axum::extract::{State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use super::connection;
use crate::app::AppState;

pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

pub async fn upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    if state.shutdown.is_stopping() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| connection::run(socket, state))
}
