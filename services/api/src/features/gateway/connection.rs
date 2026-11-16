use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket};
use protocol::Message;
use protocol::v1::{AuthOk, Envelope, Error, envelope::Payload};

use futures::StreamExt;

use super::handlers;

use crate::app::AppState;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_UNAUTHORIZED: u16 = 4001;
const HEARTBEAT: Duration = Duration::from_secs(30);
const DEAD_AFTER: Duration = Duration::from_secs(75);
pub const PRESENCE_TTL: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Copy)]
pub struct Session {
    pub user_id: i64,
    pub device_id: i64,
    pub connection_id: u64,
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

    let mut pushes = match state.events.subscribe_user(session.user_id).await {
        Ok(stream) => stream,
        Err(err) => {
            tracing::error!(error = %err, "subscribe failed");
            metrics::gauge!("ws_connections").decrement(1.0);
            return;
        }
    };

    state
        .presence
        .connected(session.user_id, session.connection_id)
        .await;
    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    heartbeat.tick().await;
    let mut last_heard = Instant::now();

    loop {
        tokio::select! {
            frame = socket.recv() => {
                let Some(Ok(frame)) = frame else { break };
                last_heard = Instant::now();
                let WsMessage::Binary(bytes) = frame else {
                    continue;
                };
                let reply = match Envelope::decode(bytes) {
                    Ok(Envelope { payload: Some(Payload::StartTyping(req)), .. }) => {
                        start_typing(&state, &session, req).await;
                        continue;
                    }
                    Ok(req) => handle(&state, &session, req).await,
                    Err(_) => error(0, "bad_frame", "not a valid Envelope"),
                };
                if send(&mut socket, reply).await.is_err() {
                    break;
                }
            }
            push = pushes.next() => {
                let Some(bytes) = push else { break };
                if socket.send(WsMessage::Binary(bytes)).await.is_err() {
                    break;
                }
            }
            _ = heartbeat.tick() => {
                if last_heard.elapsed() > DEAD_AFTER {
                    tracing::info!(user.id = session.user_id, "ws heartbeat timeout");
                    break;
                }
                if socket.send(WsMessage::Ping(Default::default())).await.is_err() {
                    break;
                }
                state.presence.heartbeat(session.user_id, session.connection_id).await;
            }
        }
    }

    state.calls.connection_closed(session.connection_id).await;

    state
        .presence
        .disconnected(session.user_id, session.connection_id)
        .await;
    metrics::gauge!("ws_connections").decrement(1.0);
    tracing::info!(user.id = session.user_id, "ws disconnected");
}

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
        connection_id: rand::random(),
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

async fn start_typing(state: &AppState, session: &Session, req: protocol::v1::StartTyping) {
    metrics::counter!("ws_requests_total").increment(1);
    if let Err(err) = state
        .typing
        .start(session.user_id, req.conversation_id as i64)
        .await
    {
        tracing::debug!(error = ?err, "start_typing rejected");
    }
}

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
