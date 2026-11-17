use std::time::Duration;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Redirect, Response};

use super::dto::{
    AvatarQuery, SearchUsersQuery, SetUsernameRequest, UpdateProfileRequest, UserDto,
};
use super::service::ProfileChanges;
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::middleware::auth::AuthUser;

pub async fn get_me(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(state.users.get(auth.user_id).await?.into()))
}

pub async fn set_username(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<SetUsernameRequest>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(
        state
            .users
            .set_username(auth.user_id, &req.username)
            .await?
            .into(),
    ))
}

const SEARCH_LIMIT_PER_USER: u32 = 30;
const SEARCH_WINDOW: Duration = Duration::from_secs(10);

pub async fn search_users(
    auth: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<SearchUsersQuery>,
) -> Result<Json<Vec<UserDto>>, ApiError> {
    state.limiter.check(
        &format!("search_users:user:{}", auth.user_id),
        SEARCH_LIMIT_PER_USER,
        SEARCH_WINDOW,
    )?;
    let users = state
        .users
        .search(auth.user_id, &query.q, query.limit)
        .await?;
    Ok(Json(users.into_iter().map(UserDto::from).collect()))
}

pub async fn update_me(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<UserDto>, ApiError> {
    let changes = ProfileChanges {
        display_name: req.display_name,
        bio: req.bio,
    };
    Ok(Json(
        state
            .users
            .update_profile(auth.user_id, changes)
            .await?
            .into(),
    ))
}

const AVATAR_LIMIT_PER_USER: u32 = 10;
const AVATAR_WINDOW: Duration = Duration::from_secs(60 * 60);

/// Body is the raw image; its type is read from the bytes, not the header.
pub async fn put_avatar(
    auth: AuthUser,
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<UserDto>, ApiError> {
    state.limiter.check(
        &format!("avatar:user:{}", auth.user_id),
        AVATAR_LIMIT_PER_USER,
        AVATAR_WINDOW,
    )?;
    Ok(Json(
        state.users.set_avatar(auth.user_id, body).await?.into(),
    ))
}

pub async fn delete_avatar(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(state.users.remove_avatar(auth.user_id).await?.into()))
}

pub async fn get_user(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(state.users.get(id).await?.into()))
}

/// 302 to a short-lived signed link. Cached a bit less than the link lives.
pub async fn get_avatar(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path((id, hash)): Path<(i64, String)>,
    Query(query): Query<AvatarQuery>,
) -> Result<Response, ApiError> {
    let url = state.users.avatar_url(id, &hash, query.size).await?;
    Ok((
        [(header::CACHE_CONTROL, "private, max-age=240")],
        Redirect::to(&url),
    )
        .into_response())
}
