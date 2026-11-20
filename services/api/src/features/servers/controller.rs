use super::dto::{
    ChannelNameBody, CreateServer, CreatedServerDto, JoinServer, MembersPage, MembersQuery,
    NamedResource, ServerInvite, ServerSummaryDto,
};
use crate::{
    app::AppState,
    common::{error::ApiError, middleware::auth::AuthUser},
};
use axum::{
    Json,
    extract::{Path, Query, State},
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

pub async fn create_channel(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
    Json(body): Json<ChannelNameBody>,
) -> Result<(StatusCode, Json<NamedResource>), ApiError> {
    state.limiter.check(
        &format!("channel_create:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    Ok((
        StatusCode::CREATED,
        Json(
            state
                .servers
                .create_channel(auth.user_id, server_id, &body.name)
                .await?
                .into(),
        ),
    ))
}
pub async fn rename_channel(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, channel_id)): Path<(i64, i64)>,
    Json(body): Json<ChannelNameBody>,
) -> Result<Json<NamedResource>, ApiError> {
    state.limiter.check(
        &format!("channel_rename:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    Ok(Json(
        state
            .servers
            .rename_channel(auth.user_id, server_id, channel_id, &body.name)
            .await?
            .into(),
    ))
}
pub async fn list_members(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
    Query(query): Query<MembersQuery>,
) -> Result<Json<MembersPage>, ApiError> {
    Ok(Json(
        state
            .servers
            .list_members(auth.user_id, server_id, query.after_id)
            .await?
            .into(),
    ))
}

pub async fn ban_member(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, user_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    state.limiter.check(
        &format!("server_ban:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    state
        .servers
        .ban_member(auth.user_id, server_id, user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn leave(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    state.limiter.check(
        &format!("server_leave:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    state.servers.leave(auth.user_id, server_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unban_member(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, user_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    state.limiter.check(
        &format!("server_unban:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    state
        .servers
        .unban_member(auth.user_id, server_id, user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn list_bans(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
    Query(query): Query<MembersQuery>,
) -> Result<Json<MembersPage>, ApiError> {
    Ok(Json(
        state
            .servers
            .list_bans(auth.user_id, server_id, query.after_id)
            .await?
            .into(),
    ))
}
