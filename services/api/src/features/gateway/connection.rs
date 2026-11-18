use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket};
use protocol::Message;
use protocol::v1::{AuthOk, Envelope, Error, envelope::Payload};

use futures::StreamExt;

use super::handlers;

use crate::app::AppState;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_UNAUTHORIZED: u16 = 4001;
const CLOSE_TOKEN_EXPIRED: u16 = 4002;
const CLOSE_SESSION_REVOKED: u16 = 4003;
const CLOSE_SERVER_ERROR: u16 = 1011;
const KICK_SEND_TIMEOUT: Duration = Duration::from_secs(5);
const HEARTBEAT: Duration = Duration::from_secs(30);
const DEAD_AFTER: Duration = Duration::from_secs(75);
pub const PRESENCE_TTL: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Copy)]
pub struct Session {
    pub user_id: i64,
    pub device_id: i64,
    pub connection_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kick {
    Expired,
    Revoked,
    Unavailable,
}

impl Kick {
    fn code(self) -> u16 {
        match self {
            Kick::Expired => CLOSE_TOKEN_EXPIRED,
            Kick::Revoked => CLOSE_SESSION_REVOKED,
            Kick::Unavailable => CLOSE_SERVER_ERROR,
        }
    }
    fn reason(self) -> &'static str {
        match self {
            Kick::Expired => "token_expired",
            Kick::Revoked => "session_revoked",
            Kick::Unavailable => "unavailable",
        }
    }
}

pub async fn run(mut socket: WebSocket, state: AppState) {
    let (session, expires_at) = match authenticate(&mut socket, &state).await {
        Ok(ok) => ok,
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

    let subscribed = tokio::try_join!(
        state.events.subscribe_user(session.user_id),
        state.events.subscribe_device_revoked(session.device_id),
    );
    let (mut pushes, mut revoked) = match subscribed {
        Ok(streams) => streams,
        Err(err) => {
            tracing::error!(error = %err, "subscribe failed");
            metrics::gauge!("ws_connections").decrement(1.0);
            return;
        }
    };

    // INVARIANT: check revocation only after subscribing, or a revoke in between is missed.
    let refused = match state.auth.is_device_revoked(session.device_id).await {
        Ok(false) => None,
        Ok(true) => Some(Kick::Revoked),
        Err(err) => {
            tracing::error!(error = ?err, "revocation check failed");
            Some(Kick::Unavailable)
        }
    };
    if let Some(why) = refused {
        kick(&mut socket, why).await;
        metrics::gauge!("ws_connections").decrement(1.0);
        return;
    }

    state
        .presence
        .connected(session.user_id, session.connection_id)
        .await;
    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    heartbeat.tick().await;
    let mut last_heard = Instant::now();
    let expiry = tokio::time::sleep_until(deadline(expires_at));
    tokio::pin!(expiry);

    let mut kicked = None;
    loop {
        tokio::select! {
            // INVARIANT: `biased` polls in order, so revoke and expiry win over a ready request.
            biased;
            hit = revoked.next() => {
                if hit.is_some() {
                    kicked = Some(Kick::Revoked);
                }
                break;
            }
            () = &mut expiry => {
                kicked = Some(Kick::Expired);
                break;
            }
            frame = socket.recv() => {
                let Some(Ok(frame)) = frame else { break };
                last_heard = Instant::now();
                if expiry.is_elapsed() {
                    kicked = Some(Kick::Expired);
                    break;
                }
                let WsMessage::Binary(bytes) = frame else {
                    continue;
                };
                let reply = match Envelope::decode(bytes) {
                    Ok(Envelope { payload: Some(Payload::StartTyping(req)), .. }) => {
                        start_typing(&state, &session, req).await;
                        continue;
                    }
                    Ok(Envelope { id, payload: Some(Payload::Authenticate(auth)) }) => {
                        match reauthenticate(&state, &session, &auth.access_token).await {
                            Ok((exp, reply)) => {
                                expiry.as_mut().reset(deadline(exp));
                                Envelope { id, payload: Some(reply) }
                            }
                            Err(code) => error(id, code, "re-authenticate failed"),
                        }
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

    if let Some(why) = kicked {
        tracing::info!(
            user.id = session.user_id,
            device.id = session.device_id,
            reason = why.reason(),
            "ws kicked"
        );
        metrics::counter!("ws_kicked_total", "reason" => why.reason()).increment(1);
        kick(&mut socket, why).await;
    }

    state.calls.connection_closed(session.connection_id).await;

    state
        .presence
        .disconnected(session.user_id, session.connection_id)
        .await;
    metrics::gauge!("ws_connections").decrement(1.0);
    tracing::info!(user.id = session.user_id, "ws disconnected");
}

async fn authenticate(
    socket: &mut WebSocket,
    state: &AppState,
) -> Result<(Session, i64), &'static str> {
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
    Ok((session, claims.expires_at))
}

async fn reauthenticate(
    state: &AppState,
    session: &Session,
    token: &str,
) -> Result<(i64, Payload), &'static str> {
    let claims = state
        .tokens
        .verify_access(token)
        .map_err(|_| "invalid_token")?;
    same_session(session, claims.user_id, claims.device_id)?;
    match state.auth.is_device_revoked(session.device_id).await {
        Ok(false) => {}
        Ok(true) => return Err("session_revoked"),
        Err(_) => return Err("unavailable"),
    }
    let user = state
        .users
        .get(session.user_id)
        .await
        .map_err(|_| "invalid_token")?;
    Ok((
        claims.expires_at,
        Payload::AuthOk(AuthOk {
            user: Some((&user).into()),
        }),
    ))
}

fn same_session(session: &Session, user_id: i64, device_id: i64) -> Result<(), &'static str> {
    if session.user_id == user_id && session.device_id == device_id {
        Ok(())
    } else {
        Err("wrong_session")
    }
}

fn deadline(expires_at: i64) -> tokio::time::Instant {
    let left = expires_at - chrono::Utc::now().timestamp();
    tokio::time::Instant::now() + Duration::from_secs(left.max(0) as u64)
}

async fn kick(socket: &mut WebSocket, why: Kick) {
    let goodbye = async {
        let _ = send(
            socket,
            error(0, why.reason(), "connection closed by server"),
        )
        .await;
        let _ = socket
            .send(WsMessage::Close(Some(CloseFrame {
                code: why.code(),
                reason: why.reason().into(),
            })))
            .await;
    };
    let _ = tokio::time::timeout(KICK_SEND_TIMEOUT, goodbye).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        Session {
            user_id: 1,
            device_id: 10,
            connection_id: 99,
        }
    }

    #[test]
    fn kick_codes() {
        assert_eq!(Kick::Expired.code(), 4002);
        assert_eq!(Kick::Revoked.code(), 4003);
        assert_eq!(Kick::Expired.reason(), "token_expired");
        assert_eq!(Kick::Revoked.reason(), "session_revoked");
        assert_eq!(Kick::Unavailable.code(), 1011);
    }

    #[test]
    fn reauth_must_match_user_and_device() {
        assert!(same_session(&session(), 1, 10).is_ok());
        assert_eq!(same_session(&session(), 1, 11), Err("wrong_session"));
        assert_eq!(same_session(&session(), 2, 10), Err("wrong_session"));
    }

    #[tokio::test]
    async fn deadline_counts_down_and_never_goes_negative() {
        let now = chrono::Utc::now().timestamp();
        let start = tokio::time::Instant::now();
        let soon = deadline(now + 60);
        assert!(soon >= start + Duration::from_secs(58));
        assert!(soon <= start + Duration::from_secs(61));
        assert!(deadline(now - 100) <= tokio::time::Instant::now());
    }
}
