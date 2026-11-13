//! WebSocket endpoint. Every binary frame is one protobuf `Envelope`.

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use protocol::Message;
use protocol::v1::{Envelope, Error, Pong, envelope::Payload};

pub async fn handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    metrics::gauge!("ws_connections").increment(1.0);
    tracing::info!("ws connected");

    while let Some(Ok(frame)) = socket.recv().await {
        let WsMessage::Binary(bytes) = frame else {
            continue;
        };
        let reply = match Envelope::decode(bytes) {
            Ok(req) => handle(req),
            Err(err) => error(0, "bad_frame", &err.to_string()),
        };
        if socket
            .send(WsMessage::Binary(reply.encode_to_vec().into()))
            .await
            .is_err()
        {
            break;
        }
    }

    metrics::gauge!("ws_connections").decrement(1.0);
    tracing::info!("ws disconnected");
}

fn handle(req: Envelope) -> Envelope {
    metrics::counter!("ws_requests_total").increment(1);
    match req.payload {
        Some(Payload::Ping(_)) => Envelope {
            id: req.id,
            payload: Some(Payload::Pong(Pong {})),
        },
        _ => error(
            req.id,
            "not_implemented",
            "request type not implemented yet",
        ),
    }
}

fn error(id: u64, code: &str, message: &str) -> Envelope {
    Envelope {
        id,
        payload: Some(Payload::Error(Error {
            code: code.into(),
            message: message.into(),
        })),
    }
}
