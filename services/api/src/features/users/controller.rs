use std::time::Duration;

use axum::Json;
use axum::extract::{Query, State};

use super::dto::{SearchUsersQuery, SetUsernameRequest, UserDto};
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
