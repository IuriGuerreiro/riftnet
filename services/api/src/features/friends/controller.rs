use std::time::Duration;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;

use super::dto::{FriendDto, FriendsResponse, SendRequestBody};
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::middleware::auth::AuthUser;

const HOUR: Duration = Duration::from_secs(60 * 60);
const REQUESTS_PER_HOUR: u32 = 20;

pub async fn list(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<FriendsResponse>, ApiError> {
    Ok(Json(state.friends.list(auth.user_id).await?.into()))
}

pub async fn send_request(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<FriendDto>, ApiError> {
    state.limiter.check(
        &format!("friend_request:user:{}", auth.user_id),
        REQUESTS_PER_HOUR,
        HOUR,
    )?;
    Ok(Json(
        state
            .friends
            .send_request(auth.user_id, &body.username)
            .await?
            .into(),
    ))
}

pub async fn accept(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(requester_id): Path<i64>,
) -> Result<Json<FriendDto>, ApiError> {
    Ok(Json(
        state
            .friends
            .accept(auth.user_id, requester_id)
            .await?
            .into(),
    ))
}

pub async fn delete_request(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(other_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    state.friends.delete_request(auth.user_id, other_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_friend(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(friend_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    state.friends.remove_friend(auth.user_id, friend_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
