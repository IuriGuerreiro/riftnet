use std::net::SocketAddr;
use std::time::Duration;

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;

use super::dto::{CredentialsRequest, RefreshRequest, SessionResponse};
use super::models::NewDevice;
use super::service::Session;
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::middleware::auth::AuthUser;

const MINUTE: Duration = Duration::from_secs(60);
const FIFTEEN_MINUTES: Duration = Duration::from_secs(15 * 60);

/// Normalized, length-capped email for rate-limit keys (input isn't validated yet).
fn rate_key_email(email: &str) -> String {
    email.trim().to_lowercase().chars().take(254).collect()
}

pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<CredentialsRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    state
        .limiter
        .check(&format!("register:ip:{}", addr.ip()), 5, MINUTE)?;
    let session = state
        .auth
        .register(&req.email, &req.password, device(req.device))
        .await?;
    Ok(Json(session.into()))
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<CredentialsRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    let ip = addr.ip();
    let email = rate_key_email(&req.email);

    // Per IP, and per IP + email: an attacker only slows themselves down.
    state.limiter.check(&format!("login:ip:{ip}"), 10, MINUTE)?;
    state
        .limiter
        .check(&format!("login:ip-email:{ip}:{email}"), 5, MINUTE)?;
    // Per email from anywhere, counting FAILED attempts only: stops distributed
    // password guessing without letting anyone lock out the real user by
    // spamming requests (a correct password never adds to this count).
    let failures_key = format!("login:failures:{email}");
    state
        .limiter
        .ensure_below(&failures_key, 20, FIFTEEN_MINUTES)?;

    match state
        .auth
        .login(&req.email, &req.password, device(req.device))
        .await
    {
        Ok(session) => Ok(Json(session.into())),
        Err(err) => {
            if matches!(err, ApiError::Unauthorized("invalid_credentials")) {
                state.limiter.record(&failures_key, FIFTEEN_MINUTES);
            }
            Err(err)
        }
    }
}

pub async fn refresh(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<SessionResponse>, ApiError> {
    state
        .limiter
        .check(&format!("refresh:ip:{}", addr.ip()), 30, MINUTE)?;
    Ok(Json(state.auth.refresh(&req.refresh_token).await?.into()))
}

pub async fn logout(auth: AuthUser, State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    state.auth.logout(auth.device_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn device(d: super::dto::DeviceInfo) -> NewDevice {
    NewDevice {
        name: d.name,
        platform: d.platform,
    }
}

impl From<Session> for SessionResponse {
    fn from(s: Session) -> Self {
        Self {
            access_token: s.access_token,
            access_expires_at: s.access_expires_at,
            refresh_token: s.refresh_token,
            user: s.user.into(),
        }
    }
}
