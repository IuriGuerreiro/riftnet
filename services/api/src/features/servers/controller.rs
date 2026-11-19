use super::dto::{
    CreateServer, CreatedServerDto, JoinServer, NamedResource, ServerInvite, ServerSummaryDto,
};
use crate::{
    app::AppState,
    common::{error::ApiError, middleware::auth::AuthUser},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use std::time::Duration;

pub async fn create(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateServer>,
) -> Result<(StatusCode, Json<CreatedServerDto>), ApiError> {
    state.limiter.check(
        &format!("server_create:user:{}", auth.user_id),
        20,
        Duration::from_secs(3600),
    )?;
    let created = state.servers.create(auth.user_id, &body.name).await?;
    Ok((StatusCode::CREATED, Json(created.into())))
}

pub async fn list(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<ServerSummaryDto>>, ApiError> {
    Ok(Json(
        state
            .servers
            .list(auth.user_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

pub async fn list_channels(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<Json<Vec<NamedResource>>, ApiError> {
    Ok(Json(
        state
            .servers
            .list_channels(auth.user_id, server_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

pub async fn invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<Json<ServerInvite>, ApiError> {
    Ok(Json(ServerInvite {
        token: state.servers.invite(auth.user_id, server_id).await?,
    }))
}

pub async fn revoke_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    state.servers.revoke_invite(auth.user_id, server_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn join(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<JoinServer>,
) -> Result<Json<NamedResource>, ApiError> {
    state.limiter.check(
        &format!("server_join:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    Ok(Json(
        state.servers.join(auth.user_id, &body.token).await?.into(),
    ))
}
