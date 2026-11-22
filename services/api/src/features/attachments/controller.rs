use std::time::Duration;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};

use super::dto::{AttachmentDto, DownloadDto, StartUploadBody};
use super::service::NewUpload;
use crate::app::AppState;
use crate::common::error::ApiError;
use crate::common::middleware::auth::AuthUser;

pub const CHUNK_HASH_HEADER: &str = "x-chunk-blake3";

const HOUR: Duration = Duration::from_secs(60 * 60);
const UPLOADS_PER_HOUR: u32 = 60;
const CHUNKS_PER_HOUR: u32 = 1000;

pub async fn start(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<StartUploadBody>,
) -> Result<(StatusCode, Json<AttachmentDto>), ApiError> {
    state.limiter.check(
        &format!("attachment_upload:user:{}", auth.user_id),
        UPLOADS_PER_HOUR,
        HOUR,
    )?;
    let conversation_id = parse_id(&body.conversation_id)?;
    let a = state
        .attachments
        .start(
            auth.user_id,
            NewUpload {
                conversation_id,
                filename: &body.filename,
                content_type: &body.content_type,
                size: body.size,
                blake3_hex: &body.blake3,
            },
        )
        .await?;
    Ok((StatusCode::CREATED, Json(a.into())))
}

pub async fn put_chunk(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((id, idx)): Path<(String, i32)>,
    headers: HeaderMap,
    body: Body,
) -> Result<StatusCode, ApiError> {
    state.limiter.check(
        &format!("attachment_chunk:user:{}", auth.user_id),
        CHUNKS_PER_HOUR,
        HOUR,
    )?;
    let hash = headers
        .get(CHUNK_HASH_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::bad_request("bad_hash", "missing x-chunk-blake3 header"))?;
    let id = parse_id(&id)?;
    let expected = state
        .attachments
        .chunk_target(auth.user_id, id, idx)
        .await?;
    let _slot = state.attachments.chunk_slot().await;
    let data = axum::body::to_bytes(body, expected)
        .await
        .map_err(|_| ApiError::bad_request("bad_chunk", "chunk has the wrong size"))?;
    state
        .attachments
        .put_chunk(auth.user_id, id, idx, hash, data)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn complete(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AttachmentDto>, ApiError> {
    let a = state
        .attachments
        .complete(auth.user_id, parse_id(&id)?)
        .await?;
    Ok(Json(a.into()))
}

pub async fn download(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DownloadDto>, ApiError> {
    let (a, url) = state
        .attachments
        .download(auth.user_id, parse_id(&id)?)
        .await?;
    Ok(Json(DownloadDto {
        attachment: a.into(),
        url,
    }))
}

pub async fn preview(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DownloadDto>, ApiError> {
    let (a, url) = state
        .attachments
        .preview(auth.user_id, parse_id(&id)?)
        .await?;
    Ok(Json(DownloadDto {
        attachment: a.into(),
        url,
    }))
}

fn parse_id(s: &str) -> Result<i64, ApiError> {
    s.parse().map_err(|_| ApiError::NotFound)
}
