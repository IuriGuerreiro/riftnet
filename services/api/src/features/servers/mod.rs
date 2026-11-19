use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use common::snowflake::Snowflake;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::app::AppState;
use crate::common::error::{ApiError, RepoError};
use crate::common::middleware::auth::AuthUser;

const DEFAULT_CHANNEL_NAME: &str = "general";

pub struct ServerService {
    pool: PgPool,
    ids: Arc<Snowflake>,
}

impl ServerService {
    pub fn new(pool: PgPool, ids: Arc<Snowflake>) -> Self {
        Self { pool, ids }
    }

    async fn create(&self, user_id: i64, name: &str) -> Result<CreatedServer, ApiError> {
        let name = name.trim();
        if !(1..=100).contains(&name.chars().count()) || name.contains('\0') {
            return Err(ApiError::bad_request(
                "invalid_server_name",
                "Server name must be 1 to 100 characters and cannot contain null characters",
            ));
        }

        let server_id = self.ids.next_id() as i64;
        let channel_id = self.ids.next_id() as i64;
        let mut transaction = self.pool.begin().await.map_err(RepoError::from)?;
        sqlx::query("INSERT INTO servers (id, name) VALUES ($1, $2)")
            .bind(server_id)
            .bind(name)
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        sqlx::query(
            "INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')",
        )
        .bind(server_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(RepoError::from)?;
        sqlx::query("INSERT INTO server_channels (id, server_id, name) VALUES ($1, $2, $3)")
            .bind(channel_id)
            .bind(server_id)
            .bind(DEFAULT_CHANNEL_NAME)
            .execute(&mut *transaction)
            .await
            .map_err(RepoError::from)?;
        transaction.commit().await.map_err(RepoError::from)?;

        Ok(CreatedServer {
            server: NamedResource::new(server_id, name.into()),
            default_channel: NamedResource::new(channel_id, DEFAULT_CHANNEL_NAME.into()),
        })
    }

    async fn list(&self, user_id: i64) -> Result<Vec<ServerSummary>, RepoError> {
        let servers = sqlx::query_as::<_, (i64, String, bool)>(
            "SELECT s.id, s.name, m.role = 'owner'
             FROM server_members m JOIN servers s ON s.id = m.server_id
             WHERE m.user_id = $1 ORDER BY s.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(servers
            .into_iter()
            .map(|(id, name, is_owner)| ServerSummary {
                server: NamedResource::new(id, name),
                is_owner,
            })
            .collect())
    }

    async fn list_channels(
        &self,
        user_id: i64,
        server_id: i64,
    ) -> Result<Vec<NamedResource>, ApiError> {
        let rows = sqlx::query_as::<_, (Option<i64>, Option<String>)>(
            "SELECT c.id, c.name
             FROM server_members m LEFT JOIN server_channels c ON c.server_id = m.server_id
             WHERE m.user_id = $1 AND m.server_id = $2 ORDER BY c.id",
        )
        .bind(user_id)
        .bind(server_id)
        .fetch_all(&self.pool)
        .await
        .map_err(RepoError::from)?;
        if rows.is_empty() {
            return Err(ApiError::NotFound);
        }
        Ok(rows
            .into_iter()
            .filter_map(|(id, name)| Some(NamedResource::new(id?, name?)))
            .collect())
    }
    async fn invite(&self, user_id: i64, server_id: i64) -> Result<ServerInvite, ApiError> {
        let mut bytes = [0; 24];
        OsRng.fill_bytes(&mut bytes);
        let token = sqlx::query_scalar(
            "INSERT INTO server_invites (server_id, token)
             SELECT server_id, $3 FROM server_members
             WHERE server_id = $1 AND user_id = $2 AND role = 'owner'
             FOR SHARE
             ON CONFLICT (server_id) DO UPDATE SET token = server_invites.token
             RETURNING token",
        )
        .bind(server_id)
        .bind(user_id)
        .bind(format!("si_{}", URL_SAFE_NO_PAD.encode(bytes)))
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?
        .ok_or(ApiError::NotFound)?;
        Ok(ServerInvite { token })
    }

    async fn revoke_invite(&self, user_id: i64, server_id: i64) -> Result<(), ApiError> {
        let owner: Option<i64> = sqlx::query_scalar(
            "WITH owner AS (
                 SELECT server_id FROM server_members
                 WHERE server_id = $1 AND user_id = $2 AND role = 'owner'
                 FOR SHARE
             ), revoked AS (
                 DELETE FROM server_invites WHERE server_id IN (SELECT server_id FROM owner)
             )
             SELECT server_id FROM owner",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?;
        owner.ok_or(ApiError::NotFound)?;
        Ok(())
    }

    async fn join(&self, user_id: i64, token: &str) -> Result<NamedResource, ApiError> {
        let (id, name) = sqlx::query_as::<_, (i64, String)>(
            "WITH invited AS (
                 SELECT s.id, s.name FROM server_invites i JOIN servers s ON s.id = i.server_id
                 WHERE i.token = $1 FOR KEY SHARE OF i
             ), joined AS (
                 INSERT INTO server_members (server_id, user_id, role)
                 SELECT id, $2, 'member' FROM invited
                 ON CONFLICT (server_id, user_id) DO NOTHING
             )
             SELECT id, name FROM invited",
        )
        .bind(token)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(RepoError::from)?
        .ok_or_else(|| {
            ApiError::bad_request("invalid_invite", "This invite link is invalid or revoked")
        })?;
        Ok(NamedResource::new(id, name))
    }
}

#[derive(Deserialize)]
struct CreateServer {
    name: String,
}

#[derive(Serialize)]
struct NamedResource {
    id: String,
    name: String,
}

impl NamedResource {
    fn new(id: i64, name: String) -> Self {
        Self {
            id: id.to_string(),
            name,
        }
    }
}

#[derive(Serialize)]
struct ServerSummary {
    #[serde(flatten)]
    server: NamedResource,
    is_owner: bool,
}

#[derive(Serialize)]
struct ServerInvite {
    token: String,
}

#[derive(Deserialize)]
struct JoinServer {
    token: String,
}

#[derive(Serialize)]
struct CreatedServer {
    server: NamedResource,
    default_channel: NamedResource,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/servers", get(list).post(create))
        .route("/servers/{server_id}/channels", get(list_channels))
        .route(
            "/servers/{server_id}/invite",
            post(invite).delete(revoke_invite),
        )
        .route("/servers/join", post(join))
}

async fn create(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<CreateServer>,
) -> Result<(StatusCode, Json<CreatedServer>), ApiError> {
    state.limiter.check(
        &format!("server_create:user:{}", auth.user_id),
        20,
        Duration::from_secs(3600),
    )?;
    let created = state.servers.create(auth.user_id, &body.name).await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn list(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<ServerSummary>>, ApiError> {
    Ok(Json(state.servers.list(auth.user_id).await?))
}

async fn list_channels(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<Json<Vec<NamedResource>>, ApiError> {
    Ok(Json(
        state.servers.list_channels(auth.user_id, server_id).await?,
    ))
}

async fn invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<Json<ServerInvite>, ApiError> {
    Ok(Json(state.servers.invite(auth.user_id, server_id).await?))
}

async fn revoke_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    state.servers.revoke_invite(auth.user_id, server_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn join(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<JoinServer>,
) -> Result<Json<NamedResource>, ApiError> {
    state.limiter.check(
        &format!("server_join:user:{}", auth.user_id),
        30,
        Duration::from_secs(60),
    )?;
    Ok(Json(state.servers.join(auth.user_id, &body.token).await?))
}
