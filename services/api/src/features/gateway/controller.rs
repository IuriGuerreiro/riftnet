use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;

use super::connection;
use crate::app::AppState;

pub async fn upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| connection::run(socket, state))
}
