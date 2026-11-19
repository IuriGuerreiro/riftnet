use std::sync::Arc;
use std::time::Duration;

use axum::extract::{FromRequestParts, Path, State};
use axum::http::{StatusCode, header, request::Parts};
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use common::snowflake::Snowflake;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};

use crate::app::AppState;
use crate::common::error::{ApiError, RepoError};
use crate::common::middleware::auth::AuthUser;

const KEY_PREFIX: &str = "d2_bot_";
const MINUTE: Duration = Duration::from_secs(60);

pub struct BotService {
    pool: PgPool,
    ids: Arc<Snowflake>,
}

#[derive(FromRow, Serialize)]
struct Bot {
    id: String,
    name: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
struct KeyMetadata {
    id: String,
    name: String,
    created_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct IssuedKey {
    key: KeyMetadata,
    token: String,
}

#[derive(Deserialize)]
struct NameInput {
    name: String,
}

struct BotOwner(i64);

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

impl BotService {
    pub fn new(pool: PgPool, ids: Arc<Snowflake>) -> Self {
        Self { pool, ids }
    }

    async fn create(&self, owner: i64, name: &str) -> Result<Bot, RepoError> {
        Ok(sqlx::query_as(
            "INSERT INTO bots (id, owner_user_id, name) VALUES ($1, $2, $3)
             RETURNING id::text AS id, name, created_at",
        )
        .bind(self.ids.next_id() as i64)
        .bind(owner)
        .bind(name)
        .fetch_one(&self.pool)
        .await?)
    }

    async fn list(&self, owner: i64) -> Result<Vec<Bot>, RepoError> {
        Ok(sqlx::query_as(
            "SELECT id::text AS id, name, created_at FROM bots WHERE owner_user_id = $1
             ORDER BY bots.id",
        )
        .bind(owner)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn issue_key(&self, owner: i64, bot_id: i64, name: &str) -> Result<IssuedKey, ApiError> {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        let token = format!("{KEY_PREFIX}{}", URL_SAFE_NO_PAD.encode(secret));
        let hash = Sha256::digest(token.as_bytes());
        let key = sqlx::query_as(
            "INSERT INTO bot_api_keys (id, bot_id, name, token_hash)
             SELECT $1, id, $4, $5 FROM bots WHERE id = $2 AND owner_user_id = $3
             RETURNING id::text AS id, name, created_at, revoked_at",
        )
        .bind(self.ids.next_id() as i64)
        .bind(bot_id)
        .bind(owner)
        .bind(name)
        .bind(&hash[..])
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?
        .ok_or(ApiError::NotFound)?;
        Ok(IssuedKey { key, token })
    }

    async fn list_keys(&self, owner: i64, bot_id: i64) -> Result<Vec<KeyMetadata>, ApiError> {
        let owned: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT FROM bots WHERE id = $1 AND owner_user_id = $2)",
        )
        .bind(bot_id)
        .bind(owner)
        .fetch_one(&self.pool)
        .await
        .map_err(RepoError::from)?;
        if !owned {
            return Err(ApiError::NotFound);
        }

        Ok(sqlx::query_as(
            "SELECT k.id::text AS id, k.name, k.created_at, k.revoked_at
             FROM bot_api_keys k JOIN bots b ON b.id = k.bot_id
             WHERE b.id = $1 AND b.owner_user_id = $2 ORDER BY k.id",
        )
        .bind(bot_id)
        .bind(owner)
        .fetch_all(&self.pool)
        .await
        .map_err(RepoError::from)?)
    }

    async fn revoke_key(&self, owner: i64, bot_id: i64, key_id: i64) -> Result<(), ApiError> {
        let result = sqlx::query(
            "UPDATE bot_api_keys k SET revoked_at = COALESCE(k.revoked_at, now())
             FROM bots b WHERE b.id = k.bot_id AND b.id = $1 AND k.id = $2 AND b.owner_user_id = $3",
        )
        .bind(bot_id)
        .bind(key_id)
        .bind(owner)
        .execute(&self.pool)
        .await
        .map_err(RepoError::from)?;
        if result.rows_affected() == 0 {
            return Err(ApiError::NotFound);
        }
        Ok(())
    }

    async fn authenticate(&self, token: &str) -> Result<Bot, ApiError> {
        if token
            .strip_prefix(KEY_PREFIX)
            .is_none_or(|secret| secret.len() != 43)
        {
            return Err(ApiError::Unauthorized("invalid_bot_token"));
        }
        let hash = Sha256::digest(token.as_bytes());
        sqlx::query_as(
            "SELECT b.id::text AS id, b.name, b.created_at
             FROM bot_api_keys k JOIN bots b ON b.id = k.bot_id
             WHERE k.token_hash = $1 AND k.revoked_at IS NULL",
        )
        .bind(&hash[..])
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?
        .ok_or(ApiError::Unauthorized("invalid_bot_token"))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/bots", get(list_bots).post(create_bot))
        .route("/bots/{bot_id}/keys", get(list_keys).post(issue_key))
        .route("/bots/{bot_id}/keys/{key_id}", delete(revoke_key))
        .route("/bot/me", get(bot_me))
}

async fn create_bot(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Json(body): Json<NameInput>,
) -> Result<(StatusCode, Json<Bot>), ApiError> {
    state
        .limiter
        .check(&format!("bot_create:user:{owner}"), 10, MINUTE)?;
    let bot = state.bots.create(owner, validate_name(&body.name)?).await?;
    Ok((StatusCode::CREATED, Json(bot)))
}

async fn list_bots(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
) -> Result<Json<Vec<Bot>>, ApiError> {
    Ok(Json(state.bots.list(owner).await?))
}

async fn issue_key(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path(bot_id): Path<i64>,
    Json(body): Json<NameInput>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .limiter
        .check(&format!("bot_key_issue:user:{owner}"), 10, MINUTE)?;
    let issued = state
        .bots
        .issue_key(owner, bot_id, validate_name(&body.name)?)
        .await?;
    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(issued),
    ))
}

async fn list_keys(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path(bot_id): Path<i64>,
) -> Result<Json<Vec<KeyMetadata>>, ApiError> {
    Ok(Json(state.bots.list_keys(owner, bot_id).await?))
}

async fn revoke_key(
    BotOwner(owner): BotOwner,
    State(state): State<AppState>,
    Path((bot_id, key_id)): Path<(i64, i64)>,
) -> Result<StatusCode, ApiError> {
    state.bots.revoke_key(owner, bot_id, key_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn bot_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized("missing_token"))?;
    let bot = state.bots.authenticate(token).await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(bot)))
}

fn validate_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
        return Err(ApiError::bad_request(
            "invalid_name",
            "Name must be 1 to 100 characters and cannot contain null characters",
        ));
    }
    Ok(name)
}
