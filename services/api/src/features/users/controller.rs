use axum::Json;
use axum::extract::State;

use super::dto::{SetUsernameRequest, UserDto};
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
