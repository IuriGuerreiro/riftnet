use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};

use super::dto::{
    ImageQuery, ImageUrlDto, SearchUsersQuery, SetUsernameRequest, UpdateProfileRequest, UserDto,
};
use super::image::{MAX_IMAGE_BYTES, ProfileImage};
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
        custom_status: req.custom_status,
        pronouns: req.pronouns,
        accent_color: req.accent_color,
    };
    Ok(Json(
        state
            .users
            .update_profile(auth.user_id, changes)
            .await?
            .into(),
    ))
}

const IMAGE_LIMIT_PER_USER: u32 = 10;
const IMAGE_WINDOW: Duration = Duration::from_secs(60 * 60);

/// Body is the raw image; its type is read from the bytes, not the header.
pub async fn put_avatar(
    auth: AuthUser,
    state: State<AppState>,
    body: Body,
) -> Result<Json<UserDto>, ApiError> {
    put_image(auth, state, ProfileImage::Avatar, body).await
}

pub async fn put_banner(
    auth: AuthUser,
    state: State<AppState>,
    body: Body,
) -> Result<Json<UserDto>, ApiError> {
    put_image(auth, state, ProfileImage::Banner, body).await
}

async fn put_image(
    auth: AuthUser,
    State(state): State<AppState>,
    kind: ProfileImage,
    body: Body,
) -> Result<Json<UserDto>, ApiError> {
    state.limiter.check(
        &format!("profile_image:user:{}", auth.user_id),
        IMAGE_LIMIT_PER_USER,
        IMAGE_WINDOW,
    )?;
    // Slot first, body second: a busy server never buffers the upload.
    let slot = state.users.image_slot()?;
    let data = axum::body::to_bytes(body, MAX_IMAGE_BYTES)
        .await
        .map_err(|_| {
            ApiError::bad_request(
                "file_too_large",
                format!("{} must be 8 MB or less", kind.name()),
            )
        })?;
    Ok(Json(
        state
            .users
            .set_image(auth.user_id, kind, data, slot)
            .await?
            .into(),
    ))
}

pub async fn delete_avatar(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(
        state
            .users
            .remove_image(auth.user_id, ProfileImage::Avatar)
            .await?
            .into(),
    ))
}

pub async fn delete_banner(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(
        state
            .users
            .remove_image(auth.user_id, ProfileImage::Banner)
            .await?
            .into(),
    ))
}

pub async fn get_user(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<UserDto>, ApiError> {
    Ok(Json(state.users.get(id).await?.into()))
}

/// A short-lived (5 min) signed link to the image, like attachment downloads.
pub async fn get_avatar(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path((id, hash)): Path<(i64, String)>,
    Query(query): Query<ImageQuery>,
) -> Result<Json<ImageUrlDto>, ApiError> {
    let url = state
        .users
        .image_url(id, ProfileImage::Avatar, &hash, query.size)
        .await?;
    Ok(Json(ImageUrlDto { url }))
}

pub async fn get_banner(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path((id, hash)): Path<(i64, String)>,
) -> Result<Json<ImageUrlDto>, ApiError> {
    let url = state
        .users
        .image_url(id, ProfileImage::Banner, &hash, None)
        .await?;
    Ok(Json(ImageUrlDto { url }))
}
