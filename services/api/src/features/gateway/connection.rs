//! One connected socket, from open to close.
//!
//! 1. Wait (max 10s) for the first frame. It must be `Authenticate`.
//! 2. Check the access token, the same way HTTP does (`TokenService`).
//! 3. Reply `AuthOk { user }`, then handle requests until the socket closes.
//!
//! Anything wrong in step 1–2 → an `Error` frame, then close with code 4001.
//! Requests are handled in `handlers.rs`.

use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket};
use protocol::Message;
use protocol::v1::{AuthOk, Envelope, Error, envelope::Payload};

use super::handlers;

use crate::app::AppState;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
/// WebSocket close code for "not authenticated" (4000–4999 are free for apps).
const CLOSE_UNAUTHORIZED: u16 = 4001;

/// Who is on the other end. Lives as long as the socket.
#[derive(Debug, Clone, Copy)]
pub struct Session {
    pub user_id: i64,
    pub device_id: i64,
}

pub async fn run(mut socket: WebSocket, state: AppState) {
    let session = match authenticate(&mut socket, &state).await {
        Ok(session) => session,
        Err(reason) => {
            tracing::debug!(reason, "ws auth failed");
            let _ = send(&mut socket, error(0, reason, "authenticate first")).await;
            let _ = socket
                .send(WsMessage::Close(Some(CloseFrame {
                    code: CLOSE_UNAUTHORIZED,
                    reason: reason.into(),
                })))
                .await;
            return;
        }
    };

    tracing::info!(
        user.id = session.user_id,
        device.id = session.device_id,
        "ws connected"
    );
    metrics::gauge!("ws_connections").increment(1.0);

    while let Some(Ok(frame)) = socket.recv().await {
        let WsMessage::Binary(bytes) = frame else {
            continue; // ping/pong/text frames: ignore
        };
        let reply = match Envelope::decode(bytes) {
            Ok(req) => handle(&state, &session, req).await,
            Err(_) => error(0, "bad_frame", "not a valid Envelope"),
        };
        if send(&mut socket, reply).await.is_err() {
            break;
        }
    }

    metrics::gauge!("ws_connections").decrement(1.0);
    tracing::info!(user.id = session.user_id, "ws disconnected");
}

/// Step 1–2: read the first frame and check its token.
/// Returns an error code (sent to the client) on failure.
async fn authenticate(socket: &mut WebSocket, state: &AppState) -> Result<Session, &'static str> {
    let frame = tokio::time::timeout(AUTH_TIMEOUT, socket.recv())
        .await
        .map_err(|_| "auth_timeout")?
        .ok_or("closed")?
        .map_err(|_| "closed")?;

    let WsMessage::Binary(bytes) = frame else {
        return Err("bad_frame");
    };
    let env = Envelope::decode(bytes).map_err(|_| "bad_frame")?;
    let Some(Payload::Authenticate(auth)) = env.payload else {
        return Err("not_authenticated");
    };

    // Same check as the HTTP `AuthUser` extractor. Never log the token.
    let claims = state
        .tokens
        .verify_access(&auth.access_token)
        .map_err(|_| "invalid_token")?;
    let user = state
        .users
        .get(claims.user_id)
        .await
        .map_err(|_| "invalid_token")?;

    let session = Session {
        user_id: claims.user_id,
        device_id: claims.device_id,
    };
    let ok = Envelope {
        id: env.id,
        payload: Some(Payload::AuthOk(AuthOk {
            user: Some((&user).into()),
        })),
    };
    send(socket, ok).await.map_err(|_| "closed")?;
    Ok(session)
}

/// Step 3: one request in, one reply out (same `id`).
async fn handle(state: &AppState, session: &Session, req: Envelope) -> Envelope {
    metrics::counter!("ws_requests_total").increment(1);
    let Some(payload) = req.payload else {
        return error(req.id, "bad_frame", "empty envelope");
    };
    match handlers::dispatch(state, session, payload).await {
        Ok(reply) => Envelope {
            id: req.id,
            payload: Some(reply),
        },
        Err(err) => {
            let (_, code, message) = err.describe();
            error(req.id, code, &message)
        }
    }
}

async fn send(socket: &mut WebSocket, env: Envelope) -> Result<(), axum::Error> {
    socket
        .send(WsMessage::Binary(env.encode_to_vec().into()))
        .await
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
