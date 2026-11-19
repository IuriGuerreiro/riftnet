use std::time::Duration;

use axum::Json;
use axum::extract::{FromRequestParts, Path, State};
use axum::http::{StatusCode, header, request::Parts};
use axum::response::IntoResponse;

use super::dto::{BotResponse, IssuedKeyResponse, KeyResponse, NameInput};
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::middleware::auth::AuthUser;

const MINUTE: Duration = Duration::from_secs(60);

pub struct BotOwner(i64);

impl FromRequestParts<AppState> for BotOwner {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let auth = AuthUser::from_request_parts(parts, state).await?;
        if state.auth.is_device_revoked(auth.device_id).await? {
            return Err(ApiError::Unauthorized("session_revoked"));
        }
        Ok(Self(auth.user_id))
    }
}

pub async fn create_bot(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Json(body): Json<NameInput>,
) -> Result<(StatusCode, Json<BotResponse>), ApiError> {
    state
        .limiter
        .check(&format!("bot_create:user:{owner}"), 10, MINUTE)?;
    let bot = state.bots.create(owner, &body.name).await?;
    Ok((StatusCode::CREATED, Json(BotResponse::from(bot))))
}

pub async fn list_bots(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
) -> Result<Json<Vec<BotResponse>>, ApiError> {
    Ok(Json(
        state
            .bots
            .list(owner)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

pub async fn issue_key(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path(bot_id): Path<i64>,
    Json(body): Json<NameInput>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .limiter
        .check(&format!("bot_key_issue:user:{owner}"), 10, MINUTE)?;
    let issued = state.bots.issue_key(owner, bot_id, &body.name).await?;
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(IssuedKeyResponse::from(issued)),
    ))
}

pub async fn list_keys(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path(bot_id): Path<i64>,
) -> Result<Json<Vec<KeyResponse>>, ApiError> {
    Ok(Json(
        state
            .bots
            .list_keys(owner, bot_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

pub async fn revoke_key(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path((bot_id, key_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    state.bots.revoke_key(owner, bot_id, key_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn bot_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized("missing_token"))?;
    let bot = state.bots.authenticate(token).await?;
    Ok((
        [(header::CACHE_CONTROL, "no-store")],
        Json(BotResponse::from(bot)),
    ))
}
