use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;

use super::connection;
use crate::app::AppState;

/// `GET /ws`: the browser asks to switch this HTTP request to a WebSocket.
/// No auth here (browsers can't set headers on WebSockets); the first frame
/// on the socket carries the token instead.
pub async fn upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| connection::run(socket, state))
}
